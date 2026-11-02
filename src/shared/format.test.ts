import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration } from "./format.ts";

test("sub-minute durations keep one decimal", () => {
  assert.equal(formatDuration(0), "0.0s");
  assert.equal(formatDuration(440), "0.4s");
  assert.equal(formatDuration(3_449), "3.4s");
  assert.equal(formatDuration(59_940), "59.9s");
});

test("durations that round to a full minute switch to minutes", () => {
  assert.equal(formatDuration(59_960), "1m00s");
  assert.equal(formatDuration(60_000), "1m00s");
  assert.equal(formatDuration(134_000), "2m14s");
});

test("hour-long durations drop seconds", () => {
  assert.equal(formatDuration(3_600_000), "1h00m");
  assert.equal(formatDuration(3_725_000), "1h02m");
});
