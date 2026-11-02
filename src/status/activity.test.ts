import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { type ActivityEvent, type ActivityState, describe, initialState, reduce, summarizeTool } from "./activity.ts";

const t0 = 1_000_000;

function run(events: [number, ActivityEvent][], from: ActivityState = initialState): ActivityState {
  return events.reduce((state, [now, event]) => reduce(state, event, now), from);
}

test("waits for the model with a Thinking phase", () => {
  const state = run([[t0, { type: "agent_start" }]]);
  assert.equal(describe(state, t0 + 3200, "esc"), "Thinking 3.2s · 3.2s · esc to stop");
});

test("turn_start restarts the step but keeps the total", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 2000, { type: "turn_start" }],
  ]);
  assert.equal(describe(state, t0 + 5000, "esc"), "Thinking 3.0s · 5.0s · esc to stop");
});

test("streaming thinking stays Thinking and hides output tokens", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "message_update", kind: "thinking", outputTokens: 12 }],
  ]);
  assert.equal(describe(state, t0 + 2000, "esc"), "Thinking 2.0s · 2.0s · esc to stop");
});

test("answer text switches to Writing without a token count at zero", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "message_update", kind: "text", outputTokens: 0 }],
  ]);
  assert.equal(describe(state, t0 + 1500, "esc"), "Writing 0.5s · 1.5s · esc to stop");
});

test("Writing shows output tokens once they are positive", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "message_update", kind: "text", outputTokens: 42 }],
  ]);
  assert.equal(describe(state, t0 + 1400, "esc"), "Writing ↓42 0.4s · 1.4s · esc to stop");
});

test("a running tool shows name, first command line and step time", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 10_800, { type: "tool_execution_start", id: "1", name: "bash", args: { command: "sleep 6\nrm -rf /" } }],
  ]);
  assert.equal(describe(state, t0 + 14_000, "esc"), "bash sleep 6 3.2s · 14.0s · esc to stop");
});

test("parallel tools show the most recent one plus the others", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "tool_execution_start", id: "a", name: "read", args: { path: "/repo/a.ts" } }],
    [t0 + 2000, { type: "tool_execution_start", id: "b", name: "edit", args: { path: "/repo/b.ts" } }],
  ]);
  assert.equal(describe(state, t0 + 3000, "esc"), "edit /repo/b.ts +1 2.0s · 3.0s · esc to stop");
});

test("ending a tool falls back to the remaining one, then to Thinking", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "tool_execution_start", id: "a", name: "read", args: { path: "/repo/a.ts" } }],
    [t0 + 2000, { type: "tool_execution_start", id: "b", name: "edit", args: { path: "/repo/b.ts" } }],
    [t0 + 2500, { type: "tool_execution_end", id: "b" }],
  ]);
  assert.equal(describe(state, t0 + 3000, "esc"), "read /repo/a.ts 2.0s · 3.0s · esc to stop");
  const after = reduce(state, { type: "tool_execution_end", id: "a" }, t0 + 3000);
  assert.equal(describe(after, t0 + 3500, "esc"), "Thinking 0.5s · 3.5s · esc to stop");
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
  assert.equal(describe(initialState, t0, "esc"), "");
  const settled = reduce(run([[t0, { type: "agent_start" }]]), { type: "agent_settled" }, t0 + 1000);
  assert.equal(describe(settled, t0 + 2000, "esc"), "");
});
