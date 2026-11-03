import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { changedSpan, renderDiffRows } from "./diff.ts";

initTheme("dark");
const theme = testTheme("dark");
const options = { surface: theme.colors.toolPendingBg, wrap: false };
const plain = (rows: string[]) => rows.map((row) => stripTerminalSequences(row).trimEnd());
/** The distinct background colors a row sets. */
const tints = (row: string) =>
  new Set(
    row
      .split("\x1b[48;")
      .slice(1)
      .map((part) => part.slice(0, part.indexOf("m"))),
  );

// Pi's own format: the marker, then the line number padded to the widest number.
const DIFF = [
  "  1 import x from 'y';",
  '- 2 const host = "localhost";',
  '+ 2 const host = process.env.HOST ?? "localhost";',
  "+ 3 const debug = true;",
  "  4 app.listen(port, host);",
  "    ...",
  " 10 export default app;",
].join("\n");

test("each line becomes number, marker and text, numbers right-aligned to the widest", () => {
  assert.deepEqual(plain(renderDiffRows(DIFF, 80, theme, options)), [
    " 1   import x from 'y';",
    ' 2 - const host = "localhost";',
    ' 2 + const host = process.env.HOST ?? "localhost";',
    " 3 + const debug = true;",
    " 4   app.listen(port, host);",
    "   ⋯",
    "10   export default app;",
  ]);
});

test("added and removed rows are tinted across the whole width", () => {
  const rows = renderDiffRows(DIFF, 60, theme, options);
  for (const index of [1, 2, 3]) {
    assert.equal(visibleWidth(rows[index]), 60, JSON.stringify(rows[index]));
    assert.ok(tints(rows[index]).size > 0, "a tinted row sets a background");
  }
  assert.equal(tints(rows[0]).size, 0, "a context row keeps the panel background");
  assert.notDeepEqual(tints(rows[1]), tints(rows[2]), "removed and added rows use different tints");
});

test("the changed words of a removed/added pair get a stronger tint", () => {
  const rows = renderDiffRows(" 1 a\n-2 const a = 1;\n+2 const a = 2;", 40, theme, options);
  assert.equal(tints(rows[1]).size, 2, "row tint and word tint on the removed row");
  assert.equal(tints(rows[2]).size, 2, "row tint and word tint on the added row");
});

test("a rewritten line gets the row tint only", () => {
  const rows = renderDiffRows("-1 alpha beta gamma\n+1 something else entirely", 60, theme, options);
  for (const row of rows) assert.equal(tints(row).size, 1, JSON.stringify(row));
});

test("changed spans widen to whole words", () => {
  assert.deepEqual(changedSpan("const port = 3000;", "const port = 3001;"), { start: 13, endBefore: 17, endAfter: 17 });
  assert.deepEqual(changedSpan("a b", "a b c"), { start: 3, endBefore: 3, endAfter: 5 });
});

for (const width of [40, 100]) {
  test(`no row is wider than ${width} columns, cut or wrapped`, () => {
    const long = `-1 ${"x".repeat(150)}\n+1 ${"y".repeat(150)}`;
    const cut = renderDiffRows(long, width, theme, options);
    assert.equal(cut.length, 2);
    const wrapped = renderDiffRows(long, width, theme, { ...options, wrap: true });
    assert.ok(wrapped.length > 2, "long lines wrap when expanded");
    for (const row of [...cut, ...wrapped]) assert.ok(visibleWidth(row) <= width, JSON.stringify(row));
    assert.ok(plain(wrapped)[1].startsWith("   "), "a continuation row leaves the number and marker blank");
  });
}
