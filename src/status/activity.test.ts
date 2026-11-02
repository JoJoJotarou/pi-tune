import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { type ActivityEvent, type ActivityState, describe, initialState, reduce, summarizeTool } from "./activity.ts";

const t0 = 1_000_000;
const theme = testTheme("dark");

function run(events: [number, ActivityEvent][], from: ActivityState = initialState): ActivityState {
  return events.reduce((state, [now, event]) => reduce(state, event, now), from);
}

function line(state: ActivityState, now: number, width = 80): string {
  return stripTerminalSequences(describe(state, now, { width, interruptKey: "esc", theme }));
}

test("waits for the model with a Thinking phase and the run timer", () => {
  const state = run([[t0, { type: "agent_start" }]]);
  assert.equal(line(state, t0 + 3200), "Thinking   3.2s · esc to stop");
});

test("turn_start keeps the run timer", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 2000, { type: "turn_start" }],
  ]);
  assert.equal(line(state, t0 + 5000), "Thinking   5.0s · esc to stop");
});

test("streaming thinking stays Thinking", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "message_update", kind: "thinking" }],
  ]);
  assert.equal(line(state, t0 + 2000), "Thinking   2.0s · esc to stop");
});

test("Writing shows only the phase name, never the token rate", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "message_update", kind: "text" }],
    [t0 + 3000, { type: "message_update", kind: "text" }],
  ]);
  assert.equal(line(state, t0 + 3000), "Writing   3.0s · esc to stop");
  assert.equal(line(state, t0 + 4000).includes("tok/s"), false);
});

test("a running tool shows name and first command line", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 10_800, { type: "tool_execution_start", id: "1", name: "bash", args: { command: "sleep 6\nrm -rf /" } }],
  ]);
  assert.equal(line(state, t0 + 14_000), "bash sleep 6   14.0s · esc to stop");
});

test("parallel tools show the most recent one plus the others", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "tool_execution_start", id: "a", name: "read", args: { path: "/repo/a.ts" } }],
    [t0 + 2000, { type: "tool_execution_start", id: "b", name: "edit", args: { path: "/repo/b.ts" } }],
    [t0 + 2500, { type: "tool_execution_start", id: "c", name: "grep", args: { pattern: "TODO" } }],
  ]);
  assert.equal(line(state, t0 + 3000), 'grep "TODO" +2   3.0s · esc to stop');
});

test("ending a tool falls back to the remaining one, then to Thinking", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "tool_execution_start", id: "a", name: "read", args: { path: "/repo/a.ts" } }],
    [t0 + 2000, { type: "tool_execution_start", id: "b", name: "edit", args: { path: "/repo/b.ts" } }],
    [t0 + 2500, { type: "tool_execution_end", id: "b" }],
  ]);
  assert.equal(line(state, t0 + 3000), "read /repo/a.ts   3.0s · esc to stop");
  const after = reduce(state, { type: "tool_execution_end", id: "a" }, t0 + 3000);
  assert.equal(line(after, t0 + 3500), "Thinking   3.5s · esc to stop");
});

test("colors come from the theme: phase text, detail muted, total dim", () => {
  const thinking = run([[t0, { type: "agent_start" }]]);
  assert.equal(
    describe(thinking, t0 + 3200, { width: 80, interruptKey: "esc", theme }),
    `${theme.fg("text", "Thinking")}   ${theme.fg("dim", "3.2s · esc to stop")}`,
  );

  const tool = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "tool_execution_start", id: "a", name: "bash", args: { command: "sleep 6" } }],
  ]);
  assert.equal(
    describe(tool, t0 + 2000, { width: 80, interruptKey: "esc", theme }),
    `${theme.fg("text", "bash")} ${theme.fg("muted", "sleep 6")}   ${theme.fg("dim", "2.0s · esc to stop")}`,
  );

  const writing = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "message_update", kind: "text" }],
  ]);
  assert.equal(
    describe(writing, t0 + 3000, { width: 80, interruptKey: "esc", theme }),
    `${theme.fg("text", "Writing")}   ${theme.fg("dim", "3.0s · esc to stop")}`,
  );
});

test("narrow widths keep the stop hint and never exceed the width", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "tool_execution_start", id: "a", name: "read", args: { path: "/repo/a/very/long/path.ts" } }],
  ]);
  for (const width of [40, 24, 18]) {
    const rendered = describe(state, t0 + 2000, { width, interruptKey: "esc", theme });
    assert.ok(visibleWidth(rendered) <= width, `width ${width}: ${visibleWidth(rendered)}`);
    if (width >= 18) assert.ok(stripTerminalSequences(rendered).endsWith("to stop"), rendered);
  }
});

test("summaries cover the built-in tools", () => {
  assert.equal(summarizeTool("read", { path: "/repo/a.ts" }), "/repo/a.ts");
  assert.equal(summarizeTool("edit", { path: "/repo/a.ts" }), "/repo/a.ts");
  assert.equal(summarizeTool("write", { path: "/repo/a.ts" }), "/repo/a.ts");
  assert.equal(summarizeTool("bash", { command: "sleep 6\nrm -rf /" }), "sleep 6");
  assert.equal(summarizeTool("grep", { pattern: "TODO", path: "src" }), '"TODO"');
  assert.equal(summarizeTool("find", { pattern: "*.ts", path: "src" }), "*.ts");
  assert.equal(summarizeTool("ls", {}), ".");
  assert.equal(summarizeTool("ls", { path: "src" }), "src");
  assert.equal(summarizeTool("task", { description: "long job" }), "");
});

test("long summaries are cut to 40 columns with an ellipsis", () => {
  const summary = summarizeTool("read", { path: `${"x".repeat(80)}.ts` });
  assert.ok(visibleWidth(summary) <= 40, `width ${visibleWidth(summary)}`);
  assert.ok(stripTerminalSequences(summary).endsWith("…"), summary);
});

test("no message when idle or settled", () => {
  assert.equal(describe(initialState, t0, { width: 80, interruptKey: "esc", theme }), "");
  const settled = reduce(run([[t0, { type: "agent_start" }]]), { type: "agent_settled" }, t0 + 1000);
  assert.equal(describe(settled, t0 + 2000, { width: 80, interruptKey: "esc", theme }), "");
});
