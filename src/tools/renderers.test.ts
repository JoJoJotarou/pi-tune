import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentToolResult, BashToolDetails, EditToolDetails, ToolRenderers } from "@earendil-works/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  initTheme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  KeybindingsManager,
  setKeybindings,
  stripTerminalSequences,
  TUI_KEYBINDINGS,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { toolRenderers } from "./renderers.ts";
import { recordWriteTarget } from "./write.ts";

const cwd = mkdtempSync(join(tmpdir(), "pi-tune-tools-"));
const bash = createBashTool(cwd);
const theme = testTheme();
initTheme("dark");
setKeybindings(
  new KeybindingsManager({
    ...TUI_KEYBINDINGS,
    "app.tools.expand": { defaultKeys: "ctrl+o", description: "Toggle tool output" },
  }),
);

type BashResult = AgentToolResult<BashToolDetails | undefined>;

async function bashResult(command: string): Promise<BashResult> {
  return bash.execute("renderers-test", { command });
}

function component(lines: string[]): Component {
  return { render: () => lines, invalidate: () => {} };
}

const baseRenderers = {
  renderShell: "default",
  renderCall: () => component(["BASE CALL"]),
  renderResult: () => component(["BASE RESULT"]),
} satisfies ToolRenderers;

interface TestContext {
  args: unknown;
  toolCallId: string;
  invalidate: () => void;
  lastComponent: Component | undefined;
  state: Record<string, unknown>;
  cwd: string;
  executionStarted: boolean;
  argsComplete: boolean;
  isPartial: boolean;
  expanded: boolean;
  showImages: boolean;
  isError: boolean;
  durationMs: number | undefined;
  outputPad: number;
}

function context(overrides: Partial<TestContext> = {}): TestContext {
  return {
    args: {},
    toolCallId: "call-1",
    invalidate: () => {},
    lastComponent: undefined,
    state: {},
    cwd,
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: true,
    isError: false,
    durationMs: undefined,
    outputPad: 0,
    ...overrides,
  };
}

function plain(lines: string[]): string[] {
  return lines.map(stripTerminalSequences);
}

function callLines(name: string, args: unknown, ctx: TestContext, width = 80): string[] {
  const renderers = toolRenderers(name, () => baseRenderers);
  assert.ok(renderers, `${name} was not resolved`);
  const renderCall = renderers.renderCall;
  assert.ok(renderCall, `${name} has no renderCall`);
  return plain(renderCall(args, theme, ctx).render(width));
}

function resultLines(
  name: string,
  result: AgentToolResult<unknown>,
  options: { expanded: boolean; isPartial: boolean },
  ctx: TestContext,
  width = 80,
): string[] {
  const renderers = toolRenderers(name, () => baseRenderers);
  assert.ok(renderers, `${name} was not resolved`);
  const renderResult = renderers.renderResult;
  assert.ok(renderResult, `${name} has no renderResult`);
  return plain(renderResult(result, options, theme, ctx).render(width));
}

test("resolves only the built-in tools and gives each its own shell", () => {
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
    return baseRenderers;
  };
  assert.equal(toolRenderers("web_search", next), baseRenderers);
  assert.equal(nextCalls, 1);
  assert.equal(
    toolRenderers("web_search", () => undefined),
    undefined,
  );

  for (const name of ["bash", "read", "edit", "write", "grep", "find", "ls"]) {
    const renderers = toolRenderers(name, () => baseRenderers);
    assert.ok(renderers, `${name} was not resolved`);
    assert.equal(renderers.renderShell, "self");
    assert.notEqual(renderers.renderCall, baseRenderers.renderCall);
    assert.notEqual(renderers.renderResult, baseRenderers.renderResult);
  }
});

test("bash call summary is the first command line plus the extra line count", () => {
  const beforeResult = context({ executionStarted: false });
  assert.deepEqual(
    callLines("bash", { command: "seq 1 40" }, beforeResult).map((line) => line.trimEnd()),
    ["● bash seq 1 40"],
  );

  const heredoc = "cat <<'EOF'\nline one\nline two\nEOF";
  assert.deepEqual(
    callLines("bash", { command: heredoc }, beforeResult).map((line) => line.trimEnd()),
    ["● bash cat <<'EOF' +3 lines"],
  );
});

test("read call summary is the path only", () => {
  const ctx = context({ executionStarted: false });
  assert.deepEqual(
    callLines("read", { path: "a.txt", offset: 2, limit: 2 }, ctx).map((line) => line.trimEnd()),
    ["● read a.txt"],
  );
  assert.deepEqual(
    callLines("read", { path: "a.txt" }, ctx).map((line) => line.trimEnd()),
    ["● read a.txt"],
  );
});

test("edit, write, grep, find and ls summaries follow the contract", () => {
  const ctx = context({ executionStarted: false });
  const summarised: [string, unknown, string][] = [
    ["edit", { path: "src/a.ts" }, "● edit src/a.ts"],
    ["write", { path: "src/a.ts" }, "● write src/a.ts"],
    ["grep", { pattern: "TODO", path: "src" }, '● grep "TODO" in src'],
    ["grep", { pattern: "TODO" }, '● grep "TODO" in .'],
    ["find", { pattern: "*.ts", path: "src" }, "● find *.ts in src"],
    ["find", { pattern: "*.ts" }, "● find *.ts in ."],
    ["ls", { path: "src" }, "● ls src"],
    ["ls", {}, "● ls ."],
  ];
  for (const [name, args, expected] of summarised) {
    assert.deepEqual(
      callLines(name, args, ctx).map((line) => line.trimEnd()),
      [expected],
      name,
    );
  }
});

test("missing or non-string args use an empty summary and never throw", () => {
  const ctx = context({ executionStarted: false });
  assert.deepEqual(
    callLines("bash", {}, ctx).map((line) => line.trimEnd()),
    ["● bash"],
  );
  assert.deepEqual(
    callLines("bash", { command: 42 }, ctx).map((line) => line.trimEnd()),
    ["● bash"],
  );
  assert.deepEqual(
    callLines("bash", { command: { text: "seq 1 40" } }, ctx).map((line) => line.trimEnd()),
    ["● bash"],
  );
  assert.deepEqual(
    callLines("read", { path: ["a.txt"] }, ctx).map((line) => line.trimEnd()),
    ["● read"],
  );
  assert.deepEqual(
    callLines("grep", { pattern: 7, path: 3 }, ctx).map((line) => line.trimEnd()),
    ["● grep"],
  );
});

test("renderCall applies outputPad and counts it in the width", () => {
  const line = callLines("bash", { command: "seq 1 40" }, context({ executionStarted: false, outputPad: 5 }), 20)[0];
  assert.ok(line.startsWith("     ● bash"));
  assert.ok(visibleWidth(line) <= 20);
});

test("collapsed success and running results render no lines", async () => {
  const result = await bashResult("seq 1 40");
  assert.notEqual(result.isError, true);
  assert.deepEqual(resultLines("bash", result, { expanded: false, isPartial: false }, context(), 80), []);
  assert.deepEqual(
    resultLines(
      "bash",
      result,
      { expanded: false, isPartial: true },
      context({ isPartial: true, durationMs: undefined }),
      80,
    ),
    [],
  );
});

test("expanded results delegate to Pi's own renderer", async () => {
  const result = await bashResult("seq 1 40");
  assert.deepEqual(
    resultLines("bash", result, { expanded: true, isPartial: false }, context(), 80).map((line) => line.trimEnd()),
    ["BASE RESULT"],
  );
});

test("collapsed bash failure shows 2 head lines, a marker and 3 tail lines", async () => {
  const command = "sh -c 'seq 1 20; exit 3'";
  const result = await bashResult(command);
  assert.equal(result.isError, true);
  const ctx = context({ args: { command }, isError: true });
  const lines = resultLines("bash", result, { expanded: false, isPartial: false }, ctx, 80);

  assert.equal(lines.length, 6);
  for (const line of lines) assert.ok(line.startsWith("  │ "), line);
  assert.equal(lines[0], "  │ 1");
  assert.equal(lines[1], "  │ 2");
  assert.match(lines[2], /^ {2}│ ┄ 15 lines folded ·/);
  assert.equal(lines[3], "  │ 18");
  assert.equal(lines[4], "  │ 19");
  assert.equal(lines[5], "  │ 20");
});

test("a failed bash call shows the exit code and duration in its header", async () => {
  const command = "sh -c 'seq 1 20; exit 3'";
  const result = await bashResult(command);
  const ctx = context({ args: { command }, isError: true, durationMs: 1240 });
  resultLines("bash", result, { expanded: false, isPartial: false }, ctx, 80);

  const lines = callLines("bash", ctx.args, ctx, 40);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith("✗ bash "), lines[0]);
  assert.ok(lines[0].endsWith("exit 3 · 1.2s"), lines[0]);
  assert.equal(visibleWidth(lines[0]), 40);
});

test("other tools show the error text as an excerpt", async () => {
  const read = createReadTool(mkdtempSync(join(tmpdir(), "pi-tune-read-")));
  const message = await read.execute("renderers-test", { path: "missing.txt" }).then(
    () => "",
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  assert.match(message, /ENOENT/);

  const result: AgentToolResult<unknown> = {
    content: [{ type: "text", text: message }],
    details: undefined,
    isError: true,
  };
  const ctx = context({ args: { path: "missing.txt" }, isError: true });
  const lines = resultLines("read", result, { expanded: false, isPartial: false }, ctx, 80);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^ {2}│ ENOENT/);
});

test("outputPad indents result lines to start under the tool name", async () => {
  const command = "sh -c 'echo one; echo two; exit 3'";
  const result = await bashResult(command);
  const ctx = context({ args: { command }, isError: true, outputPad: 2 });
  const lines = resultLines("bash", result, { expanded: false, isPartial: false }, ctx, 40);
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.ok(line.startsWith("    │ "), line);
    assert.ok(visibleWidth(line) <= 40);
  }
});

test("no rendered line exceeds the width", async () => {
  const longFailure = await bashResult("sh -c 'printf \"%050d\\n\"; exit 3'");
  for (const width of [40, 20]) {
    const ctx = context({
      args: { command: "x".repeat(100) },
      isError: true,
      durationMs: 1240,
      outputPad: 2,
    });
    for (const line of resultLines("bash", longFailure, { expanded: false, isPartial: false }, ctx, width)) {
      assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
    }
    for (const line of callLines("bash", ctx.args, ctx, width)) {
      assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
    }
  }
});

const metaDir = mkdtempSync(join(tmpdir(), "pi-tune-meta-"));
writeFileSync(join(metaDir, "notes.txt"), "one\ntwo\nthree\n");
mkdirSync(join(metaDir, "sub"));
writeFileSync(join(metaDir, "sub", "one.ts"), "x\n");
writeFileSync(join(metaDir, "sub", "two.ts"), "x\n");

test("the header shows the result meta once renderResult has run", async () => {
  const cases = [
    {
      name: "read",
      args: { path: "notes.txt" },
      result: await createReadTool(metaDir).execute("meta-test", { path: "notes.txt" }),
      meta: "3 lines",
    },
    {
      name: "grep",
      args: { pattern: "x" },
      result: await createGrepTool(metaDir).execute("meta-test", { pattern: "x" }),
      meta: "2 matches · 2 files",
    },
    {
      name: "find",
      args: { pattern: "*.ts" },
      result: await createFindTool(metaDir).execute("meta-test", { pattern: "*.ts" }),
      meta: "2 files",
    },
    {
      name: "ls",
      args: {},
      result: await createLsTool(metaDir).execute("meta-test", {}),
      meta: "1 dir · 1 file",
    },
  ];

  for (const { name, args, result, meta } of cases) {
    const ctx = context({ args });
    assert.deepEqual(resultLines(name, result, { expanded: false, isPartial: false }, ctx, 80), [], name);

    const lines = callLines(name, args, ctx, 80);
    assert.equal(lines.length, 1, name);
    assert.ok(lines[0].startsWith("✓ "), lines[0]);
    assert.ok(lines[0].endsWith(` ${meta}`), lines[0]);
    assert.equal(visibleWidth(lines[0]), 80, name);
  }
});

test("a running call has no meta", () => {
  const running = context({ executionStarted: false });
  const calls: [string, unknown, string][] = [
    ["read", { path: "notes.txt" }, "● read notes.txt"],
    ["grep", { pattern: "x" }, '● grep "x" in .'],
    ["find", { pattern: "*.ts" }, "● find *.ts in ."],
    ["ls", {}, "● ls ."],
  ];
  for (const [name, args, expected] of calls) {
    assert.deepEqual(
      callLines(name, args, running).map((line) => line.trimEnd()),
      [expected],
      name,
    );
  }
});

test("bash keeps exit 3 as the failure meta and has none on success", async () => {
  const command = "sh -c 'seq 1 5; exit 3'";
  const failed = await bashResult(command);
  assert.equal(failed.isError, true);
  const failedCtx = context({ args: { command }, isError: true });
  resultLines("bash", failed, { expanded: false, isPartial: false }, failedCtx, 80);
  const failedLine = callLines("bash", { command }, failedCtx, 80)[0];
  assert.ok(failedLine.startsWith("✗ bash "), failedLine);
  assert.ok(failedLine.endsWith("exit 3"), failedLine);

  const success = "seq 1 5";
  const ok = await bashResult(success);
  const okCtx = context({ args: { command: success } });
  resultLines("bash", ok, { expanded: false, isPartial: false }, okCtx, 80);
  assert.deepEqual(
    callLines("bash", { command: success }, okCtx, 80).map((line) => line.trimEnd()),
    ["✓ bash seq 1 5"],
  );
});

/** A file of `count` lines with the needle on each of `needleLines` (1-based). */
function needleFile(count: number, needleLines: number[]): string {
  return `${Array.from({ length: count }, (_, i) => (needleLines.includes(i + 1) ? "NEEDLE" : "filler")).join("\n")}\n`;
}

test("expanded grep shows one aligned row per file with counts and line numbers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-grep-"));
  mkdirSync(join(dir, "src", "tools"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), needleFile(80, [12, 40, 77]));
  writeFileSync(join(dir, "src", "tools", "read.ts"), needleFile(8, [8]));

  const result = await createGrepTool(dir).execute("renderers-test", { pattern: "NEEDLE" });
  const args = { pattern: "NEEDLE" };
  const rows = resultLines("grep", result, { expanded: true, isPartial: false }, context({ args }), 80);

  assert.deepEqual(
    [...rows].sort(),
    ["  src/index.ts        3 matches  12, 40, 77", "  src/tools/read.ts   1 match    8"].sort(),
  );
});

test("expanded grep cuts its rows to the width", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-grep-wide-"));
  const relative = "a-very-long-directory-name/another/deep/module-file.ts";
  mkdirSync(join(dir, "a-very-long-directory-name", "another", "deep"), { recursive: true });
  writeFileSync(join(dir, relative), needleFile(120, [8, 12, 40, 77, 100]));

  const result = await createGrepTool(dir).execute("renderers-test", { pattern: "NEEDLE" });
  const args = { pattern: "NEEDLE" };
  const rows = resultLines("grep", result, { expanded: true, isPartial: false }, context({ args, outputPad: 2 }), 40);

  assert.equal(rows.length, 1);
  for (const row of rows) {
    assert.ok(row.startsWith("    "), row);
    assert.ok(row.includes("…"), row);
    assert.ok(visibleWidth(row) <= 40, row);
  }
});

const EDIT_SERVER = `import http from "node:http";

const PORT = 3000;
const HOST = "127.0.0.1";

function requestHandler(req, res) {
  res.setHeader("Content-Type", "text/plain");
  res.end("ok");
}

function startServer() {
  server.listen(PORT, HOST, () => {
    console.log("Server started .");
  });
}
`;

interface Edit {
  oldText: string;
  newText: string;
}

async function realEdit(
  name: string,
  source: string,
  edits: Edit[],
): Promise<{ result: AgentToolResult<unknown>; path: string }> {
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-edit-"));
  const path = join(dir, name);
  writeFileSync(path, source);
  const result = await createEditTool(dir).execute("renderers-test", { path, edits });
  return { result, path };
}

const SERVER_EDITS: Edit[] = [
  { oldText: "const PORT = 3000;", newText: "const PORT = Number(process.env.PORT ?? 3000);" },
  {
    oldText: '    console.log("Server started .");',
    newText: "    console.log(`Server started on port ${PORT}.`);",
  },
];

test("edit results show a small diff below the +added −removed header meta", async () => {
  const { result, path } = await realEdit("server.ts", EDIT_SERVER, SERVER_EDITS);
  const ctx = context({ args: { path } });
  const body = resultLines("edit", result, { expanded: false, isPartial: false }, ctx, 80);
  const header = callLines("edit", { path }, ctx, 80)[0];

  assert.ok(header.endsWith(" +2 −2"), header);
  assert.ok(body.length > 0);
  for (const line of body) assert.ok(line.startsWith("  "), line);
  assert.ok(
    body.some((line) => line.includes("│-const PORT = 3000;")),
    body.join("\n"),
  );
  assert.ok(
    body.some((line) => line.includes("│+const PORT = Number")),
    body.join("\n"),
  );
});

test("more than eight changed lines fold the edit and add the expand key to the meta", async () => {
  const source = `${Array.from({ length: 12 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n")}\n`;
  const oldBlock = Array.from({ length: 6 }, (_, index) => `const value${index + 4} = ${index + 4};`).join("\n");
  const newBlock = Array.from({ length: 6 }, (_, index) => `const value${index + 4} = ${(index + 4) * 10};`).join("\n");
  const { result } = await realEdit("large.ts", source, [{ oldText: oldBlock, newText: newBlock }]);
  const args = { path: "large.ts" };
  const ctx = context({ args });
  const body = resultLines("edit", result, { expanded: false, isPartial: false }, ctx, 80);
  const header = callLines("edit", args, ctx, 80)[0];

  assert.deepEqual(body, []);
  assert.ok(header.endsWith(" +6 −6 · ctrl+o"), header);
});

test("expanded edits show the diff with three context lines", async () => {
  const source = `${Array.from({ length: 8 }, (_, index) => `const line${index + 1} = ${index + 1};`)
    .map((line, index) => (index === 4 ? "const old = 5;" : line))
    .join("\n")}\n`;
  const { result, path } = await realEdit("context.ts", source, [
    { oldText: "const old = 5;", newText: "const now = 50;" },
  ]);
  const args = { path };
  const collapsedCtx = context({ args });
  const collapsed = resultLines("edit", result, { expanded: false, isPartial: false }, collapsedCtx, 80);
  const expandedCtx = context({ args });
  const expanded = resultLines("edit", result, { expanded: true, isPartial: false }, expandedCtx, 80);

  assert.equal(collapsed.length, 4);
  assert.ok(!collapsed.some((line) => line.includes("const line2 = 2;")), collapsed.join("\n"));
  assert.equal(expanded.length, 8);
  assert.ok(
    expanded.some((line) => line.includes("const line2 = 2;")),
    expanded.join("\n"),
  );
  assert.ok(callLines("edit", args, expandedCtx, 80)[0].endsWith(" +1 −1"));
});

test("edit diff lines stay within the width at 80 and 40", async () => {
  const source = `const one = 1;\nexport const message = "short";\nconst three = 3;\n`;
  const { result, path } = await realEdit("long.ts", source, [
    {
      oldText: 'export const message = "short";',
      newText: 'export const message = "a much longer message that will not fit on one rendered row";',
    },
  ]);
  const args = { path };

  for (const width of [80, 40]) {
    for (const expanded of [false, true]) {
      const ctx = context({ args, outputPad: 2 });
      const body = resultLines("edit", result, { expanded, isPartial: false }, ctx, width);
      assert.ok(body.length > 0);
      for (const line of body) {
        assert.ok(line.startsWith("    "), line);
        assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
      }
      const header = callLines("edit", args, ctx, width)[0];
      assert.ok(visibleWidth(header) <= width, `width ${width}: ${JSON.stringify(header)}`);
    }
  }
});

test("an edit result without a patch falls back to Pi's renderer and has no meta", () => {
  const result = {
    content: [{ type: "text", text: "Successfully edited a.ts" }],
    details: { diff: "1 file changed" },
  } as unknown as AgentToolResult<EditToolDetails>;
  const args = { path: "a.ts" };
  const ctx = context({ args });

  assert.deepEqual(resultLines("edit", result, { expanded: false, isPartial: false }, ctx, 80), ["BASE RESULT"]);
  assert.equal(ctx.state.meta, undefined);
  const header = callLines("edit", args, ctx, 80)[0];
  assert.ok(!header.includes("+0 −0"), header);
});

let writeCalls = 0;

interface RealWrite {
  result: AgentToolResult<unknown>;
  args: { path: string; content: string };
  toolCallId: string;
}

/** Runs Pi's write tool after recording what the target looked like, as the extension does. */
async function realWrite(name: string, oldText: string | undefined, content: string): Promise<RealWrite> {
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-write-"));
  if (oldText !== undefined) writeFileSync(join(dir, name), oldText);
  writeCalls += 1;
  const toolCallId = `write-${writeCalls}`;
  await recordWriteTarget(toolCallId, dir, name);
  const result = await createWriteTool(dir).execute("renderers-test", { path: name, content });
  return { result, args: { path: name, content }, toolCallId };
}

const WRITE_LINES = Array.from({ length: 15 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n");

test("a new file shows its line count and the first numbered rows", async () => {
  const content = "export const a = 1;\nexport const b = 2;\n";
  const { result, args, toolCallId } = await realWrite("small.ts", undefined, content);
  const ctx = context({ args, toolCallId });
  const body = resultLines("write", result, { expanded: false, isPartial: false }, ctx, 80);
  const header = callLines("write", args, ctx, 80)[0];

  assert.ok(header.endsWith(" new file · 2 lines"), header);
  assert.deepEqual(
    body.map((line) => line.trimEnd()),
    ["  1 │ export const a = 1;", "  2 │ export const b = 2;"],
  );
});

test("a new file of fifteen lines folds to three numbered rows and the rest", async () => {
  const content = `${WRITE_LINES}\n`;
  const { result, args, toolCallId } = await realWrite("server.ts", undefined, content);
  const ctx = context({ args, toolCallId });
  const body = resultLines("write", result, { expanded: false, isPartial: false }, ctx, 80);
  const header = callLines("write", args, ctx, 80)[0];

  assert.ok(header.endsWith(" new file · 15 lines"), header);
  assert.equal(body.length, 4);
  assert.deepEqual(
    body.slice(0, 3).map((line) => line.trimEnd()),
    ["   1 │ const value1 = 1;", "   2 │ const value2 = 2;", "   3 │ const value3 = 3;"],
  );
  assert.match(body[3], /^ {2}┄ 12 more lines ·/);
});

test("expanded new files show every numbered row", async () => {
  const content = `${WRITE_LINES}\n`;
  const { result, args, toolCallId } = await realWrite("expanded.ts", undefined, content);
  const ctx = context({ args, toolCallId });
  const body = resultLines("write", result, { expanded: true, isPartial: false }, ctx, 80);

  assert.equal(body.length, 15);
  assert.deepEqual(body.map((line) => line.trimEnd())[14], "  15 │ const value15 = 15;");
  assert.ok(callLines("write", args, ctx, 80)[0].endsWith(" new file · 15 lines"));
});

const WRITE_README = `${Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n")}\n`;

test("an overwrite shows how many lines it added and removed with its diff", async () => {
  const content = `${WRITE_README.replace("line 4", "line four")}line 9\n`;
  const { result, args, toolCallId } = await realWrite("README.md", WRITE_README, content);
  const ctx = context({ args, toolCallId });
  const body = resultLines("write", result, { expanded: false, isPartial: false }, ctx, 80);
  const header = callLines("write", args, ctx, 80)[0];

  assert.ok(header.endsWith(" overwrite · +2 −1"), header);
  assert.ok(
    body.some((line) => line.includes("│-line 4")),
    body.join("\n"),
  );
  assert.ok(
    body.some((line) => line.includes("│+line four")),
    body.join("\n"),
  );
  assert.ok(
    body.some((line) => line.includes("│+line 9")),
    body.join("\n"),
  );
});

test("an overwrite of more than eight changed lines folds until expanded", async () => {
  const oldText = `${Array.from({ length: 12 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n")}\n`;
  const content = `${Array.from({ length: 12 }, (_, index) => `const value${index + 1} = ${(index + 1) * 10};`).join(
    "\n",
  )}\n`;
  const { result, args, toolCallId } = await realWrite("big.ts", oldText, content);
  const ctx = context({ args, toolCallId });
  const body = resultLines("write", result, { expanded: false, isPartial: false }, ctx, 80);
  const header = callLines("write", args, ctx, 80)[0];

  assert.deepEqual(body, []);
  assert.ok(header.endsWith(" overwrite · +12 −12 · ctrl+o"), header);

  const expandedCtx = context({ args, toolCallId });
  const expanded = resultLines("write", result, { expanded: true, isPartial: false }, expandedCtx, 80);
  assert.ok(
    expanded.some((line) => line.includes("│-const value1 = 1;")),
    expanded.join("\n"),
  );
  assert.ok(callLines("write", args, expandedCtx, 80)[0].endsWith(" overwrite · +12 −12"));
});

test("an overwrite without old text is a line count and no body", async () => {
  const oldText = `${"x".repeat(1024 * 1024 + 1)}`;
  const { result, args, toolCallId } = await realWrite("big.txt", oldText, "line one\nline two\n");
  const ctx = context({ args, toolCallId });
  const body = resultLines("write", result, { expanded: false, isPartial: false }, ctx, 80);
  const header = callLines("write", args, ctx, 80)[0];

  assert.deepEqual(body, []);
  assert.ok(header.endsWith(" overwrite · 2 lines"), header);
});

test("a write without a record is a line count and no body", async () => {
  const content = `${WRITE_LINES}\n`;
  const { result, args } = await realWrite("resumed.ts", undefined, content);
  const ctx = context({ args, toolCallId: "resumed-session" });
  const body = resultLines("write", result, { expanded: false, isPartial: false }, ctx, 80);
  const header = callLines("write", args, ctx, 80)[0];

  assert.deepEqual(body, []);
  assert.ok(header.endsWith(" 15 lines"), header);
});

test("a running or failed write keeps the plain tool rows", async () => {
  const { result, args, toolCallId } = await realWrite("running.ts", undefined, "a\n");
  const running = context({ args, toolCallId, executionStarted: false });
  assert.deepEqual(resultLines("write", result, { expanded: false, isPartial: false }, running, 80), []);
  assert.equal(running.state.meta, undefined);

  const failed = context({ args, toolCallId, isError: true });
  const failedResult: AgentToolResult<unknown> = {
    content: [{ type: "text", text: "EACCES: permission denied" }],
    details: undefined,
    isError: true,
  };
  const lines = resultLines("write", failedResult, { expanded: false, isPartial: false }, failed, 80);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^ {2}│ EACCES/);
  assert.equal(failed.state.meta, undefined);
});

test("write rows stay within the width at 80 and 40", async () => {
  const content = `${WRITE_LINES}\n`;
  const fresh = await realWrite("wide.ts", undefined, content);
  const changed = await realWrite("README.md", WRITE_README, `${WRITE_README.replace("line 4", "line four")}line 9\n`);

  for (const width of [80, 40]) {
    for (const expanded of [false, true]) {
      for (const { result, args, toolCallId } of [fresh, changed]) {
        const ctx = context({ args, toolCallId, outputPad: 2 });
        const body = resultLines("write", result, { expanded, isPartial: false }, ctx, width);
        assert.ok(body.length > 0, `width ${width}`);
        for (const line of body) {
          assert.ok(line.startsWith("    "), line);
          assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
        }
        const header = callLines("write", args, ctx, width)[0];
        assert.ok(visibleWidth(header) <= width, `width ${width}: ${JSON.stringify(header)}`);
      }
    }
  }
});
