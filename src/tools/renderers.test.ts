import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentToolResult, ToolRenderers } from "@earendil-works/pi-coding-agent";
import { initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { toolRenderers } from "./renderers.ts";
import { rememberWriteRecord } from "./write.ts";

const theme = testTheme();
initTheme("dark");

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
    cwd: "/tmp",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: true,
    isError: false,
    durationMs: undefined,
    outputPad: 1,
    ...overrides,
  };
}

function plain(lines: string[]): string[] {
  return lines.map(stripTerminalSequences);
}

function callLines(name: string, args: unknown, ctx: TestContext, width = 80): string[] {
  const renderers = toolRenderers(name, () => baseRenderers);
  assert.ok(renderers, `${name} was not resolved`);
  assert.ok(renderers.renderCall, `${name} has no renderCall`);
  return renderers.renderCall(args, theme, ctx).render(width);
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
  assert.ok(renderers.renderResult, `${name} has no renderResult`);
  return renderers.renderResult(result, options, theme, ctx).render(width);
}

function text(value: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: value }], details: undefined };
}

function bgOpen(token: "toolPendingBg" | "toolSuccessBg" | "toolErrorBg"): string {
  return theme.bg(token, "").replace("\u001b[49m", "");
}

function assertPainted(lines: string[], token: "toolPendingBg" | "toolSuccessBg" | "toolErrorBg"): void {
  const open = bgOpen(token);
  assert.ok(lines.length > 0, "nothing was rendered");
  for (const line of lines) assert.ok(line.startsWith(open), `not painted with ${token}: ${JSON.stringify(line)}`);
}

function assertFits(lines: string[], width: number): void {
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(stripTerminalSequences(line))}`);
  }
}

test("resolves only the built-in tools and keeps each one's renderers", () => {
  let nextCalls = 0;
  const custom = toolRenderers("custom_tool", () => {
    nextCalls++;
    return baseRenderers;
  });
  assert.equal(nextCalls, 1);
  assert.equal(custom, baseRenderers);

  for (const name of ["bash", "read", "edit", "write", "grep", "find", "ls"]) {
    const renderers = toolRenderers(name, () => baseRenderers);
    assert.ok(renderers, `${name} was not resolved`);
    assert.equal(renderers.renderShell, "self");
  }
});

test("each tool summarises its arguments", () => {
  const summaries: [string, unknown, string][] = [
    ["bash", { command: "seq 1 40" }, "seq 1 40"],
    ["bash", { command: "cat <<'EOF'\none\ntwo\nEOF" }, "cat <<'EOF' +3 lines"],
    ["read", { path: "README.md" }, "README.md"],
    ["edit", { path: "src/a.ts" }, "src/a.ts"],
    ["write", { path: "src/a.ts" }, "src/a.ts"],
    ["grep", { pattern: "TODO", path: "src" }, '"TODO" in src'],
    ["find", { pattern: "*.ts", path: "src" }, "*.ts in src"],
    ["ls", { path: "src" }, "src"],
    ["ls", {}, "."],
  ];
  for (const [name, args, summary] of summaries) {
    const lines = plain(callLines(name, args, context()));
    assert.deepEqual(
      lines.map((line) => line.trim()),
      ["", `✓ ${name} ${summary}`, ""],
    );
  }
});

test("a SKILL.md read keeps Pi's own [skill] label instead of the path", () => {
  const path = "/repo/.agents/skills/use-tinyfish/SKILL.md";
  const ctx = context({ args: { path } });
  const lines = plain(callLines("read", { path }, ctx));

  assert.equal(lines.length, 3);
  assert.equal(lines[1].trim(), "✓ [skill] use-tinyfish");
});

test("the [skill] label and the skill name use Pi's own label colors", () => {
  const path = "/repo/.agents/skills/use-tinyfish/SKILL.md";
  const line = callLines("read", { path }, context({ args: { path } }))[1];

  assert.ok(line.includes(theme.fg("customMessageLabel", theme.bold("[skill]"))), line);
  assert.ok(line.includes(theme.fg("customMessageText", "use-tinyfish")), line);
});

test("a relative SKILL.md read finds the skill from the cwd", () => {
  const path = ".agents/skills/use-tinyfish/SKILL.md";
  const ctx = context({ args: { path }, cwd: "/repo" });
  assert.equal(plain(callLines("read", { path }, ctx))[1].trim(), "✓ [skill] use-tinyfish");
});

test("missing or non-string args use an empty summary and never throw", () => {
  for (const args of [undefined, null, 42, {}, { command: 7 }, { path: null }]) {
    const lines = plain(callLines("bash", args, context()));
    assert.equal(lines.length, 3);
    assert.equal(lines[1].trim(), "✓ bash");
  }
});

test("the header is one painted line between two blank rows in the status background", () => {
  const running = callLines("bash", { command: "sleep 1" }, context({ executionStarted: false }));
  assert.equal(running.length, 3);
  assertPainted(running, "toolPendingBg");
  assert.deepEqual(
    plain(running).map((line) => line.trim()),
    ["", "● bash sleep 1", ""],
  );

  const done = callLines("bash", { command: "true" }, context());
  assertPainted(done, "toolSuccessBg");

  const failed = callLines("bash", { command: "false" }, context({ isError: true }));
  assertPainted(failed, "toolErrorBg");
  assert.equal(plain(failed)[1].trim(), "✗ bash false");
});

test("renderCall applies outputPad and still fits the width", () => {
  for (const pad of [0, 1, 3]) {
    for (const width of [40, 100]) {
      const lines = callLines("bash", { command: "seq 1 40" }, context({ outputPad: pad }), width);
      assert.equal(lines.length, 3);
      assertFits(lines, width);
      const line = plain(lines)[1];
      assert.equal(line.slice(0, pad), " ".repeat(pad));
      assert.equal(line.slice(pad).trim(), "✓ bash seq 1 40");
    }
  }
});

test("the header shows the result meta and duration right-aligned on the same painted line", () => {
  const ctx = context({ args: { command: "sh -c 'exit 3'" }, isError: true, durationMs: 1240 });
  resultLines("bash", text("boom\nCommand exited with code 3"), { expanded: false, isPartial: false }, ctx);
  const lines = callLines("bash", { command: "sh -c 'exit 3'" }, ctx);
  assert.equal(lines.length, 3);
  assertPainted(lines, "toolErrorBg");
  assert.match(plain(lines)[1].trimEnd(), /^ ✗ bash sh -c 'exit 3'\s+exit 3 · 1\.2s$/);
});

test("the header keeps the timeline rail's two columns free on the right", () => {
  const ctx = context({ args: { command: "true" }, durationMs: 1240 });
  const line = plain(callLines("bash", { command: "true" }, ctx, 60))[1];
  // The rail draws over the last two columns; the counts keep one blank column in front of it.
  const withoutRail = line.slice(0, 60 - 2);

  assert.match(withoutRail, /1\.2s $/, JSON.stringify(line));
});

test("a running call has no meta", () => {
  const ctx = context({ args: { command: "sleep 1" }, executionStarted: false });
  const lines = plain(callLines("bash", { command: "sleep 1" }, ctx));
  assert.equal(lines[1].trim(), "● bash sleep 1");
});

test("collapsed successes have no body", () => {
  const results: [string, unknown, AgentToolResult<unknown>][] = [
    ["bash", { command: "seq 1 5" }, text("1\n2\n3\n4\n5\n")],
    ["read", { path: "README.md" }, text("one\ntwo\n")],
    ["grep", { pattern: "TODO" }, text("a.ts:1: x")],
    ["find", { pattern: "*.ts" }, text("a.ts\n")],
    ["ls", {}, text("a.ts\n")],
  ];
  for (const [name, args, result] of results) {
    const ctx = context({ args });
    const lines = resultLines(name, result, { expanded: false, isPartial: false }, ctx);
    assert.deepEqual(lines, [], `${name} rendered a body while collapsed`);
  }
});

test("expanded results are Pi's own output in a painted body, indented under the tool name", () => {
  const ctx = context({ args: { path: "README.md" }, executionStarted: true });
  const lines = resultLines("read", text("one\ntwo"), { expanded: true, isPartial: false }, ctx, 40);
  const rendered = plain(lines);

  assert.equal(rendered.length, 2, rendered.join("\n"));
  assert.equal(rendered[0].trim(), "BASE RESULT");
  assert.equal(rendered[1].trim(), "");
  assertPainted(lines, "toolSuccessBg");
  assertFits(lines, 40);
});

test("an expanded body keeps two columns free on the right, like the left indent", () => {
  const diff = `-1 ${"x".repeat(120)}\n+1 ${"y".repeat(120)}`;
  const result: AgentToolResult<unknown> = { content: [{ type: "text", text: "ok" }], details: { diff } };
  const ctx = context({ args: { path: "src/a.ts" } });
  const rows = plain(resultLines("edit", result, { expanded: true, isPartial: false }, ctx, 60));

  assert.ok(rows.length > 3, rows.join("\n"));
  for (const row of rows.slice(1, -1)) {
    assert.equal(visibleWidth(row), 60, JSON.stringify(row));
    assert.ok(row.endsWith("  "), `no right inset: ${JSON.stringify(row)}`);
    assert.ok(row.startsWith("  "), `no left inset: ${JSON.stringify(row)}`);
  }
});

test("an expanded bash call draws the whole command in its header, wrapped, and no $ line", () => {
  const command = `echo ${"x".repeat(150)}`;
  const ctx = context({ args: { command }, expanded: true });
  const header = plain(callLines("bash", { command }, ctx, 40)).slice(1, -1);

  assert.ok(header.length > 1, header.join("\n"));
  assert.ok(header[0].trimStart().startsWith("✓ bash echo "), header.join("\n"));
  const commandText = header.join("");
  assert.equal(commandText.split("x").length - 1, 150);
  assert.ok(!commandText.includes("…"), commandText);
  assertFits(header, 40);

  const body = plain(resultLines("bash", text("output\n"), { expanded: true, isPartial: false }, ctx, 40));
  assert.deepEqual(
    body.map((line) => line.trim()),
    ["BASE RESULT", ""],
    body.join("\n"),
  );
});

test("a failed bash call shows the last 3 output lines and the truncation line", () => {
  const ctx = context({ args: { command: "sh -c 'seq 1 20; exit 3'" }, isError: true });
  const lines = resultLines(
    "bash",
    text(`1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n17\n18\n19\n20\nCommand exited with code 3`),
    { expanded: false, isPartial: false },
    ctx,
  );
  assert.deepEqual(
    plain(lines).map((line) => line.trim()),
    ["18", "19", "20", "… 17 more lines · click to expand", ""],
  );
  assertPainted(lines, "toolErrorBg");
});

test("a failed bash call with few output lines shows them all and no truncation line", () => {
  const ctx = context({ args: { command: "sh -c 'exit 3'" }, isError: true });
  const lines = resultLines(
    "bash",
    text("(no output)\nCommand exited with code 3"),
    { expanded: false, isPartial: false },
    ctx,
  );
  assert.deepEqual(lines, []);

  const two = plain(
    resultLines("bash", text("boom\nCommand exited with code 3"), { expanded: false, isPartial: false }, ctx),
  );
  assert.deepEqual(
    two.map((line) => line.trim()),
    ["boom", ""],
  );
});

test("an expanded failure keeps its command in the header and the whole output in the body", () => {
  const command = "sh -c 'seq 1 5; exit 3'";
  const ctx = context({ args: { command }, isError: true, expanded: true });
  assert.equal(plain(callLines("bash", { command }, ctx))[1].trim(), `✗ bash ${command}`);

  const lines = plain(
    resultLines("bash", text("1\n2\n3\n4\n5\nCommand exited with code 3"), { expanded: true, isPartial: false }, ctx),
  );
  assert.ok(!lines.some((line) => line.includes("$ sh -c")), lines.join("\n"));
  assert.ok(
    lines.some((line) => line.trim() === "BASE RESULT"),
    lines.join("\n"),
  );
});

test("an edit shows its counts and the diff from the first change until expanded", () => {
  const diff = " 1 a\n-2 b\n+2 B\n 3 c\n-4 d\n+4 D\n 5 e";
  const ctx = context({ args: { path: "a.ts" } });
  const collapsed = resultLines("edit", { content: [], details: { diff } }, { expanded: false, isPartial: false }, ctx);
  const header = plain(callLines("edit", { path: "a.ts" }, ctx))[1];
  assert.match(header, /\+2 −2/);

  const rendered = plain(collapsed);
  const body = rendered.slice(0, -1);
  assert.equal(body.length, 4, rendered.join("\n"));
  assert.equal(body[0].trim(), "2 - b");
  assert.equal(body[1].trim(), "2 + B");
  assert.equal(body[2].trim(), "3   c");
  assert.equal(body[3].trim(), "… 4 more lines · click to expand");
  // The diff sits in the status-colored block like every other body.
  assertPainted(collapsed, "toolSuccessBg");

  const expanded = plain(
    resultLines("edit", { content: [], details: { diff } }, { expanded: true, isPartial: false }, ctx),
  );
  assert.equal(expanded.length, diff.split("\n").length + 1);
  assert.ok(!expanded.some((line) => line.includes("click to expand")));
});

test("a short diff is shown whole while collapsed", () => {
  const diff = " 1 a\n-2 b\n+2 B";
  const ctx = context({ args: { path: "a.ts" } });
  const lines = plain(
    resultLines("edit", { content: [], details: { diff } }, { expanded: false, isPartial: false }, ctx),
  );
  assert.deepEqual(
    lines.slice(0, -1).map((line) => line.trim()),
    ["1   a", "2 - b", "2 + B"],
  );
});

test("an edit without diff details falls back to Pi's renderer", () => {
  const ctx = context({ args: { path: "a.ts" } });
  const lines = plain(resultLines("edit", text("nothing"), { expanded: false, isPartial: false }, ctx));
  assert.ok(
    lines.some((line) => line.trim() === "BASE RESULT"),
    lines.join("\n"),
  );
  assert.equal(callLines("edit", { path: "a.ts" }, ctx)[1].includes("+"), false);
});

test("a new file shows its first three lines and a truncation line", () => {
  rememberWriteRecord("call-1", { existed: false });
  const content = Array.from({ length: 15 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n");
  const ctx = context({ args: { path: "src/new.ts", content } });
  const lines = plain(resultLines("write", text("ok"), { expanded: false, isPartial: false }, ctx));

  assert.match(plain(callLines("write", { path: "src/new.ts" }, ctx))[1], /new · 15 lines/);
  assert.deepEqual(
    lines.slice(0, -1).map((line) => line.trim()),
    ["1 │ const value1 = 1;", "2 │ const value2 = 2;", "3 │ const value3 = 3;", "… 12 more lines · click to expand"],
  );

  const expanded = plain(resultLines("write", text("ok"), { expanded: true, isPartial: false }, ctx));
  assert.equal(expanded.length, 16);
});

test("an overwrite diffs against the old text and folds to three lines", () => {
  const oldText = "one\ntwo\nthree\nfour\nfive\n";
  const content = "one\nTWO\nthree\nfour\nfive\nsix\n";
  rememberWriteRecord("call-1", { existed: true, oldText });
  const ctx = context({ args: { path: "notes.txt", content } });
  const lines = plain(resultLines("write", text("ok"), { expanded: false, isPartial: false }, ctx));

  assert.match(plain(callLines("write", { path: "notes.txt" }, ctx))[1], /overwrite · \+2 −1/);
  const body = lines.slice(0, -1);
  assert.equal(body.length, 4, lines.join("\n"));
  assert.match(body[3].trim(), /^… \d+ more lines · click to expand$/);

  const expanded = plain(resultLines("write", text("ok"), { expanded: true, isPartial: false }, ctx));
  assert.ok(
    expanded.some((line) => line.includes("2 + TWO")),
    expanded.join("\n"),
  );
  assert.ok(!expanded.some((line) => line.includes("click to expand")));
});

test("an overwrite without old text shows the new lines and says only overwrite", () => {
  rememberWriteRecord("call-1", { existed: true });
  const content = "one\ntwo\nthree\nfour\n";
  const ctx = context({ args: { path: "notes.txt", content } });
  const lines = plain(resultLines("write", text("ok"), { expanded: false, isPartial: false }, ctx));
  assert.match(plain(callLines("write", { path: "notes.txt" }, ctx))[1], /overwrite\s/);
  assert.deepEqual(
    lines.slice(0, -1).map((line) => line.trim()),
    ["1 │ one", "2 │ two", "3 │ three", "… 1 more line · click to expand"],
  );
});

test("a write without a record has only a line count", () => {
  const ctx = context({ args: { path: "notes.txt", content: "one\ntwo\n" }, toolCallId: "unknown" });
  assert.deepEqual(resultLines("write", text("ok"), { expanded: false, isPartial: false }, ctx), []);
  assert.match(plain(callLines("write", { path: "notes.txt" }, ctx))[1], /2 lines/);
});

test("an unfinished write has no body", () => {
  rememberWriteRecord("call-1", { existed: false });
  const ctx = context({ args: { path: "src/new.ts", content: "one\n" }, executionStarted: false });
  assert.deepEqual(resultLines("write", text(""), { expanded: false, isPartial: true }, ctx), []);
});

test("expanded grep draws a tree instead of Pi's own result output", () => {
  const ctx = context({ args: { pattern: "TODO" } });
  const lines = plain(resultLines("grep", text("a.ts:1: TODO"), { expanded: true, isPartial: false }, ctx));
  assert.deepEqual(
    lines.slice(0, -1).map((line) => line.slice(3).trimEnd()),
    ["└─ a.ts", "   └─ 1  TODO"],
  );
  assert.ok(!lines.some((line) => line.includes("BASE RESULT")), lines.join("\n"));
});

test("no tool block mentions ctrl+o or the expand keybinding", () => {
  const cases: [string, unknown, AgentToolResult<unknown>, boolean][] = [
    ["bash", { command: "seq 1 40" }, text("1\n2\n3\n4\n5\n"), true],
    ["bash", { command: "false" }, text("1\n2\n3\n4\n5\nCommand exited with code 1"), false],
    ["read", { path: "README.md" }, text("a\nb\n"), true],
    ["edit", { path: "a.ts" }, { content: [], details: { diff: " 1 a\n-2 b\n+2 B\n 3 c\n-4 d\n+4 D" } }, false],
  ];
  for (const [name, args, result, expanded] of cases) {
    const ctx = context({ args, isError: !expanded && name === "bash" });
    const lines = [...callLines(name, args, ctx), ...resultLines(name, result, { expanded, isPartial: false }, ctx)];
    const joined = plain(lines).join("\n");
    assert.ok(!joined.includes("ctrl+o"), `${name}: ${joined}`);
  }
});

test("every rendered line fits widths 40 and 100", () => {
  const diff = " 1 a\n-2 b\n+2 B\n 3 c\n-4 d\n+4 D\n 5 e";
  const content = Array.from({ length: 15 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n");
  rememberWriteRecord("call-1", { existed: true, oldText: "one\ntwo\n" });

  const cases: [string, unknown, AgentToolResult<unknown>, TestContext][] = [
    ["bash", { command: `echo ${"x".repeat(120)}` }, text("1\n2\n3\n4\n5\n"), context()],
    ["read", { path: "a/very/long/path/to/a/file/with/a/long/name.ts" }, text("x".repeat(200)), context()],
    ["edit", { path: "a.ts" }, { content: [], details: { diff } }, context()],
    ["write", { path: "src/new.ts", content }, text("ok"), context()],
    [
      "write",
      { path: "notes.txt", content: "one\ntwo\n" },
      text("ok"),
      context({ args: { path: "notes.txt", content: "one\ntwo\n" } }),
    ],
  ];

  for (const width of [40, 100]) {
    for (const [name, args, result, base] of cases) {
      const ctx = { ...base, args };
      for (const expanded of [false, true]) {
        assertFits(callLines(name, args, ctx, width), width);
        assertFits(resultLines(name, result, { expanded, isPartial: false }, ctx, width), width);
      }
    }
  }
});

test("every body line of a painted block opens with the background escape", () => {
  const ctx = context({ args: { path: "README.md" } });
  const lines = resultLines("read", text("one\ntwo"), { expanded: true, isPartial: false }, ctx);
  assertPainted(lines, "toolSuccessBg");

  rememberWriteRecord("call-1", { existed: false });
  const writeCtx = context({ args: { path: "new.ts", content: "one\ntwo\n" } });
  assertPainted(resultLines("write", text("ok"), { expanded: false, isPartial: false }, writeCtx), "toolSuccessBg");
});

test("Pi's own component draws a failed bash call through our renderers", () => {
  const renderers = toolRenderers("bash", () => baseRenderers);
  assert.ok(renderers);
  const ui = { requestRender: () => {} };
  const component = new ToolExecutionComponent(
    "bash",
    "call-error",
    { command: "sh -c 'seq 1 20; exit 3'" },
    { outputPad: 1 },
    renderers,
    ui as never,
    "/tmp",
  );
  component.updateArgs({ command: "sh -c 'seq 1 20; exit 3'" } as never);
  component.markExecutionStarted();
  component.updateResult({
    content: [
      {
        type: "text",
        text: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15\n16\n17\n18\n19\n20\nCommand exited with code 3",
      },
    ],
    details: undefined,
    isError: true,
    durationMs: 12,
  });

  const lines = plain(component.render(100));
  assert.ok(!lines.some((line) => line.includes("ctrl+o")), lines.join("\n"));
  assert.ok(!lines.some((line) => line.includes("more lines,")), lines.join("\n"));
  const shown = lines.map((line) => line.trim()).filter((line) => line !== "");
  assert.match(shown[0], /^✗ bash sh -c 'seq 1 20; exit 3'\s+exit 3 · 0\.0s$/);
  assert.deepEqual(shown.slice(1), ["18", "19", "20", "… 17 more lines · click to expand"]);
});

test("expanding a bash call never hands our block back to Pi's renderer", () => {
  const reuse = {
    renderShell: "default",
    renderCall: () => component(["BASE CALL"]),
    renderResult: (
      _result: AgentToolResult<unknown>,
      options: { expanded: boolean },
      _theme: unknown,
      context: { lastComponent?: Component },
    ) => {
      // Pi's shell renderer reuses whatever it last returned by clearing it.
      if (options.expanded) (context.lastComponent as (Component & { clear(): void }) | undefined)?.clear();
      return component(["NATIVE"]);
    },
  } satisfies ToolRenderers;

  const renderers = toolRenderers("bash", () => reuse);
  assert.ok(renderers);
  const command = `true # ${Array.from({ length: 35 }, (_, index) => `tok${index + 1}`).join(" ")}`;
  const shell = new ToolExecutionComponent(
    "bash",
    "call-long",
    { command },
    { outputPad: 1 },
    renderers,
    { requestRender: () => {} } as never,
    "/tmp",
  );
  shell.updateArgs({ command } as never);
  shell.markExecutionStarted();
  shell.updateResult({ content: [{ type: "text", text: "(no output)" }], details: undefined, isError: false });
  shell.setExpanded(true);

  const lines = plain(shell.render(80));
  const text = lines.join("\n");
  assert.ok(!text.includes("(no output)"), `Pi drew its fallback:\n${text}`);
  assert.ok(text.includes("NATIVE"), text);
  assert.ok(text.includes("✓ bash true # tok1 "), text);
  assert.ok(text.includes("tok35"), `the command was cut:\n${text}`);
  assertFits(lines, 80);
});
