import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildThoughtSummary } from "./summary.ts";

test("formats measured duration and estimated tokens", () => {
  const markdown = "a".repeat(1000);
  assert.equal(buildThoughtSummary(markdown, 23_000, 80, visibleWidth), "◆ Thought for 23s (250 tokens)");
  assert.equal(buildThoughtSummary("x", 62_000, 80, visibleWidth), "◆ Thought for 1m02s (1 tokens)");
});

test("truncates instead of exceeding a narrow width", () => {
  const line = buildThoughtSummary("a".repeat(4000), 23_000, 20, visibleWidth);
  assert.ok(visibleWidth(line) <= 20);
  assert.ok(line.endsWith("…"));
});

test("never exceeds width 40 across sizes", () => {
  for (const chars of [0, 10, 100, 100_000]) {
    for (const ms of [400, 18_000, 134_000, 3_600_000]) {
      const line = buildThoughtSummary("a".repeat(chars), ms, 40, visibleWidth);
      assert.ok(visibleWidth(line) <= 40);
    }
  }
});
