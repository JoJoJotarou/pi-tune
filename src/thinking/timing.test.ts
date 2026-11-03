import assert from "node:assert/strict";
import { test } from "node:test";
import { createThinkingTiming } from "./timing.ts";

test("a duration is looked up by its trimmed text", () => {
  const timing = createThinkingTiming();
  timing.seed("  plan\nthe answer \n", 2_400);
  assert.equal(timing.durationFor("plan\nthe answer"), 2_400);
  assert.equal(timing.durationFor("  plan\nthe answer  "), 2_400);
  assert.equal(timing.durationFor("other"), undefined);
});

test("seed rejects empty text and non-finite or negative durations", () => {
  const timing = createThinkingTiming();
  timing.seed("", 1_000);
  timing.seed("negative", -1);
  timing.seed("nan", Number.NaN);
  assert.equal(timing.durationFor(""), undefined);
  assert.equal(timing.durationFor("negative"), undefined);
  assert.equal(timing.durationFor("nan"), undefined);
});

test("reset clears all durations", () => {
  const timing = createThinkingTiming();
  timing.seed("first", 1_000);
  timing.reset();
  assert.equal(timing.durationFor("first"), undefined);
});
