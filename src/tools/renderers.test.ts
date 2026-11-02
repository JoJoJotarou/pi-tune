import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentToolResult, BashToolDetails, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { createBashTool, createReadTool, formatReadLineRange } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { toolRenderers } from "./renderers.ts";

const cwd = mkdtempSync(join(tmpdir(), "pi-tune-tools-"));
const bash = createBashTool(cwd);
const theme = testTheme();

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

test("read call summary is the path and line range", () => {
  const ctx = context({ executionStarted: false });
  const range = formatReadLineRange(2, 2);
  assert.deepEqual(
    callLines("read", { path: "a.txt", offset: 2, limit: 2 }, ctx).map((line) => line.trimEnd()),
    [`● read a.txt${range}`],
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
