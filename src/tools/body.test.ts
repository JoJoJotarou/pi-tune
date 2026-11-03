import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { diffCounts, diffMeta, trimOutput, truncationLine } from "./body.ts";

const theme = testTheme();

function dimOpen(): string {
  return theme.fg("dim", "").replace("\u001b[39m", "");
}

test("the truncation line says exactly how much is hidden and never names a key", () => {
  const many = truncationLine(27, theme);
  assert.ok(many.startsWith(dimOpen()), JSON.stringify(many));
  assert.equal(stripTerminalSequences(many), "… 27 more lines · click to expand");
  assert.equal(stripTerminalSequences(truncationLine(1, theme)), "… 1 more line · click to expand");
  assert.ok(!many.includes("ctrl+o"));
});

test("diffCounts counts Pi's diff lines into additions and removals", () => {
  assert.deepEqual(diffCounts(" 1 a\n-2 b\n+2 B\n+3 c"), { added: 2, removed: 1 });
  assert.deepEqual(diffCounts(""), { added: 0, removed: 0 });
});

test("diffMeta is a plain count for edit and is prefixed for a write", () => {
  assert.equal(diffMeta(" 1 a\n-2 b\n+2 B"), "+1 −1");
  assert.equal(diffMeta(" 1 a\n-2 b\n+2 B", "overwrite"), "overwrite · +1 −1");
});

test("trimOutput drops the blank rows Pi pads around its output and trailing spaces", () => {
  assert.deepEqual(trimOutput(["   ", "a   ", "b", "", "Took 0.0s   "]), ["a", "b", "", "Took 0.0s"]);
  assert.deepEqual(trimOutput(["", "  "]), []);
});
