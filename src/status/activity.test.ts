import assert from "node:assert/strict";
import test from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import {
  type ActivityEvent,
  type ActivityState,
  describe,
  doneTitle,
  initialState,
  reduce,
  workedFor,
} from "./activity.ts";

const t0 = 1_000_000;
const theme = testTheme("dark");

function run(events: [number, ActivityEvent][], from: ActivityState = initialState): ActivityState {
  return events.reduce((state, [now, event]) => reduce(state, event, now), from);
}

function line(state: ActivityState, now: number, width = 80): string {
  return stripTerminalSequences(describe(state, now, { width, interruptKey: "esc", theme }));
}

test("waits for the model with Pi's Working phase and the run timer", () => {
  const state = run([[t0, { type: "agent_start" }]]);
  assert.equal(line(state, t0 + 3200), "Working 3.2s · esc to stop");
});

test("turn_start keeps the run timer", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 2000, { type: "turn_start" }],
  ]);
  assert.equal(line(state, t0 + 5000), "Working 5.0s · esc to stop");
});

test("streaming thinking stays Thinking", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "message_update", kind: "thinking" }],
  ]);
  assert.equal(line(state, t0 + 2000), "Thinking 2.0s · esc to stop");
});

test("Responding shows only the phase name, never the token rate", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "message_update", kind: "text" }],
    [t0 + 3000, { type: "message_update", kind: "text" }],
  ]);
  assert.equal(line(state, t0 + 3000), "Responding 3.0s · esc to stop");
  assert.equal(line(state, t0 + 4000).includes("tok/s"), false);
});

test("a running tool reads as Working, with no tool name and no command", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 10_800, { type: "tool_execution_start", id: "1" }],
  ]);
  const rendered = line(state, t0 + 14_000);
  assert.equal(rendered, "Working 14s · esc to stop");
});

test("parallel tools still read as one Working line", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "tool_execution_start", id: "a" }],
    [t0 + 2000, { type: "tool_execution_start", id: "b" }],
    [t0 + 2500, { type: "tool_execution_start", id: "c" }],
  ]);
  assert.equal(line(state, t0 + 3000), "Working 3.0s · esc to stop");
  assert.deepEqual(state.tools, ["a", "b", "c"]);
});

test("a tool phase covers every running tool and ends with the last one", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "message_update", kind: "text" }],
    [t0 + 2000, { type: "tool_execution_start", id: "a" }],
    [t0 + 2500, { type: "tool_execution_start", id: "b" }],
    [t0 + 3000, { type: "tool_execution_end", id: "b" }],
  ]);
  assert.equal(line(state, t0 + 3500), "Working 3.5s · esc to stop");
  const after = reduce(state, { type: "tool_execution_end", id: "a" }, t0 + 3500);
  assert.equal(line(after, t0 + 4000), "Working 4.0s · esc to stop");
});

test("colors come from the theme: phase text, detail muted, total dim", () => {
  const thinking = run([[t0, { type: "agent_start" }]]);
  assert.equal(
    describe(thinking, t0 + 3200, { width: 80, interruptKey: "esc", theme }),
    `${theme.fg("text", "Working")} ${theme.fg("dim", "3.2s · esc to stop")}`,
  );

  const tool = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "tool_execution_start", id: "a" }],
  ]);
  assert.equal(
    describe(tool, t0 + 2000, { width: 80, interruptKey: "esc", theme }),
    `${theme.fg("text", "Working")} ${theme.fg("dim", "2.0s · esc to stop")}`,
  );

  const writing = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "message_update", kind: "text" }],
  ]);
  assert.equal(
    describe(writing, t0 + 3000, { width: 80, interruptKey: "esc", theme }),
    `${theme.fg("text", "Responding")} ${theme.fg("dim", "3.0s · esc to stop")}`,
  );
});

test("narrow widths keep the stop hint and never exceed the width", () => {
  const state = run([
    [t0, { type: "agent_start" }],
    [t0 + 1000, { type: "tool_execution_start", id: "a" }],
  ]);
  for (const width of [40, 24, 18]) {
    const rendered = describe(state, t0 + 2000, { width, interruptKey: "esc", theme });
    assert.ok(visibleWidth(rendered) <= width, `width ${width}: ${visibleWidth(rendered)}`);
    if (width >= 18) assert.ok(stripTerminalSequences(rendered).endsWith("to stop"), rendered);
  }
});

test("no message when idle or settled", () => {
  assert.equal(describe(initialState, t0, { width: 80, interruptKey: "esc", theme }), "");
  const settled = reduce(run([[t0, { type: "agent_start" }]]), { type: "agent_settled" }, t0 + 1000);
  assert.equal(describe(settled, t0 + 2000, { width: 80, interruptKey: "esc", theme }), "");
});

test("a finished run leaves its elapsed time", () => {
  assert.equal(workedFor(2900), "Worked for 2.9s");
  assert.equal(workedFor(0), "Worked for 0.0s");
});

test("a finished run of 15 s or more sets the done title; shorter or aborted runs do not", () => {
  assert.equal(doneTitle(15_000, false), "✓ pi · done 15s");
  assert.equal(doneTitle(14_999, false), undefined);
  assert.equal(doneTitle(60_000, true), undefined);
});
