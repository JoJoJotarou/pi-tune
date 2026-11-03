import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { bashCommandLines, diffCounts, diffMeta, trimOutput, truncationLine } from "./body.ts";

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

test("bashCommandLines keeps the whole command and draws Pi's title", () => {
  const command = `echo ${"x".repeat(60)}`;
  for (const width of [40, 100]) {
    const lines = bashCommandLines(command, width, theme);
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
    const text = lines.map(stripTerminalSequences).join("");
    assert.ok(text.startsWith("$ echo"));
    assert.equal(text.split("x").length - 1, 60);
  }
});

test("bashCommandLines starts every line of a multi-line command at the prompt column", () => {
  const lines = bashCommandLines("echo one\necho two", 80, theme).map(stripTerminalSequences);
  assert.deepEqual(lines, ["$ echo one", "  echo two"]);
});

test("trimOutput drops the blank rows Pi pads around its output and trailing spaces", () => {
  assert.deepEqual(trimOutput(["   ", "a   ", "b", "", "Took 0.0s   "]), ["a", "b", "", "Took 0.0s"]);
  assert.deepEqual(trimOutput(["", "  "]), []);
});
