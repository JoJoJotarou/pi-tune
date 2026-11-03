import assert from "node:assert/strict";
import { test } from "node:test";
import { railCoveredColumns, setRailCoveredColumns } from "./rail.ts";

test("the covered columns are whole and never negative", () => {
  try {
    setRailCoveredColumns(2);
    assert.equal(railCoveredColumns(), 2);

    setRailCoveredColumns(1.8);
    assert.equal(railCoveredColumns(), 1);

    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      setRailCoveredColumns(bad);
      assert.equal(railCoveredColumns(), 0, String(bad));
    }
  } finally {
    setRailCoveredColumns(0);
  }
});
