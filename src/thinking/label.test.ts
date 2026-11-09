import assert from "node:assert/strict";
import { test } from "node:test";
import { buildThoughtLabel } from "./label.ts";

test("a measured run names its time", () => {
  assert.equal(buildThoughtLabel(3_400), "◆ Thought for 3.4s");
  assert.equal(buildThoughtLabel(18_000), "◆ Thought for 18s");
});

test("an unmeasured run claims no time", () => {
  assert.equal(buildThoughtLabel(undefined), "◆ Thought");
});
