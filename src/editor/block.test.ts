import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { blockContentWidth, blockEdgeRow, blockRows, statusLine } from "./block.ts";

const plain = (line: string) => stripTerminalSequences(line);
const theme = testTheme();

test("the block spans the width it is given, minus a gutter inside it", () => {
  assert.equal(blockContentWidth(40), 40 - 3);
  assert.equal(blockContentWidth(16), 13);
});

test("every row is exactly the width it was given", () => {
  for (const width of [40, 20, 16]) {
    const rows = blockRows(["hello", "world"], width, "❯", (text) => text);
    for (const row of rows) assert.equal(visibleWidth(row), width);
  }
});

test("the paint covers the gutter and the text, edge to edge", () => {
  const paint = (text: string) => `\u001b[48;5;238m${text}\u001b[49m`;
  const [first, second] = blockRows(["hello ", "world "], 20, "❯", paint);
  assert.ok(first?.startsWith("\u001b[48;5;238m ❯ hello"), JSON.stringify(first));
  assert.ok(second?.startsWith("\u001b[48;5;238m   world"), JSON.stringify(second));
  for (const row of [first, second]) assert.ok(row?.endsWith("\u001b[49m"), JSON.stringify(row));
});

test("the top edge paints the lower half of its row, the bottom edge the upper half", () => {
  const fill = theme.colors.toolPendingBg;
  const top = blockEdgeRow(20, "top", fill, theme);
  const bottom = blockEdgeRow(20, "bottom", fill, theme);
  assert.equal(plain(top), "▄".repeat(20));
  assert.equal(plain(bottom), "▀".repeat(20));
  const open = theme.style("", { fg: fill }).replace("\u001b[39m", "");
  assert.ok(top.startsWith(open), "the edge takes the block colour as a foreground");
  assert.equal(visibleWidth(top), 20);
});

test("the gutter glyph only leads the first row", () => {
  const rows = blockRows(["a", "b", "c"], 24, "❯", (text) => text).map(plain);
  assert.match(rows[0] ?? "", /^ ❯ a/);
  for (const row of rows.slice(1)) assert.match(row, /^ {3}/);
});

test("an over-wide row is cut to the block, never past it", () => {
  const rows = blockRows(["x".repeat(80)], 20, "❯", (text) => text);
  assert.equal(visibleWidth(rows[0] ?? ""), 20);
});

test("the status line starts one column in and is cut with an ellipsis", () => {
  assert.equal(statusLine("Working", 40), " Working");
  const long = statusLine("Working ".repeat(20), 20);
  assert.equal(visibleWidth(long), 20);
  assert.match(plain(long), /\.\.\.$|…$/);
});
