import assert from "node:assert/strict";
import { test } from "node:test";
import { createThinkingTiming } from "./timing.ts";

test("a finished block is looked up by its trimmed text", () => {
  const timing = createThinkingTiming();
  timing.start(1_000);
  timing.finish("  plan\nthe answer \n", 3_400);
  assert.equal(timing.durationFor("plan\nthe answer"), 2_400);
  assert.equal(timing.durationFor("  plan\nthe answer  "), 2_400);
  assert.equal(timing.durationFor("other"), undefined);
});

test("the start time is exposed while a block streams and cleared when it ends", () => {
  const timing = createThinkingTiming();
  assert.equal(timing.startedAt(), undefined);
  timing.start(5_000);
  assert.equal(timing.startedAt(), 5_000);
  timing.finish("done", 6_500);
  assert.equal(timing.startedAt(), undefined);
  assert.equal(timing.durationFor("done"), 1_500);
});

test("finishing without a start records nothing", () => {
  const timing = createThinkingTiming();
  timing.finish("orphan", 1_000);
  assert.equal(timing.durationFor("orphan"), undefined);
});

test("reset clears the running start and all durations", () => {
  const timing = createThinkingTiming();
  timing.start(1_000);
  timing.finish("first", 2_000);
  timing.start(3_000);
  timing.reset();
  assert.equal(timing.startedAt(), undefined);
  assert.equal(timing.durationFor("first"), undefined);
});
