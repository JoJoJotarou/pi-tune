import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { changedSpan, prepareDiff, previewLines, renderDiffRows } from "./diff.ts";

initTheme("dark");
const theme = testTheme("dark");
const options = { wrap: false };
const plain = (rows: string[]) => rows.map((row) => stripTerminalSequences(row).trimEnd());
/** Rows of a diff at a width, optionally highlighted as some language. */
const rendered = (diffText: string, width: number, opts = options, language?: string) =>
  renderDiffRows(prepareDiff(diffText, language), width, theme, opts);

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
  assert.deepEqual(plain(rendered(DIFF, 80)), [
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
  const rows = rendered(DIFF, 60);
  for (const index of [1, 2, 3]) {
    assert.equal(visibleWidth(rows[index]), 60, JSON.stringify(rows[index]));
    assert.ok(tints(rows[index]).size > 0, "a tinted row sets a background");
  }
  assert.equal(tints(rows[0]).size, 0, "a context row keeps the block background");
  assert.notDeepEqual(tints(rows[1]), tints(rows[2]), "removed and added rows use different tints");
});

test("removed rows take the theme's error background as is", () => {
  const rows = rendered(DIFF, 60);
  assert.ok(rows[1].includes(theme.getBgAnsi("toolErrorBg")), JSON.stringify(rows[1]));
});

test("line numbers and markers take the change color, context numbers stay dim", () => {
  const rows = rendered(DIFF, 60);
  const removed = theme.getFgAnsi("toolDiffRemoved");
  const added = theme.getFgAnsi("toolDiffAdded");
  const dim = theme.getFgAnsi("dim");

  assert.ok(rows[1].includes(`${removed} 2`), JSON.stringify(rows[1]));
  assert.ok(rows[1].includes(`${removed}-`), JSON.stringify(rows[1]));
  assert.ok(rows[2].includes(`${added} 2`), JSON.stringify(rows[2]));
  assert.ok(rows[0].includes(`${dim} 1`), JSON.stringify(rows[0]));
});

test("both sides are highlighted, and a context row keeps the new side's colors", () => {
  const diff = ["  1 const a = 1;", "- 2 // old note", "+ 2 // new note", "  3 const b = 2;"].join("\n");
  const rows = rendered(diff, 60, options, "typescript");

  assert.ok(rows[0].includes(theme.getFgAnsi("syntaxKeyword")), JSON.stringify(rows[0]));
  assert.ok(rows[1].includes(theme.getFgAnsi("syntaxComment")), JSON.stringify(rows[1]));
  assert.ok(rows[2].includes(theme.getFgAnsi("syntaxComment")), JSON.stringify(rows[2]));
  assert.deepEqual(plain(rows), ["1   const a = 1;", "2 - // old note", "2 + // new note", "3   const b = 2;"]);
});

test("highlighting keeps a construct that spans several removed lines", () => {
  const diff = ["- 1 /* note", "- 2    still note", "  3 const a = 1;"].join("\n");
  const prepared = prepareDiff(diff, "typescript");
  const comment = theme.getFgAnsi("syntaxComment");

  assert.ok(prepared.highlighted[0]?.startsWith(comment), JSON.stringify(prepared.highlighted[0]));
  assert.ok(prepared.highlighted[1]?.startsWith(comment), JSON.stringify(prepared.highlighted[1]));
});

test("an unknown language leaves the code plain", () => {
  const prepared = prepareDiff(DIFF, undefined);
  assert.ok(prepared.highlighted.every((text) => text === undefined));
  assert.deepEqual(plain(renderDiffRows(prepared, 80, theme, options)), plain(rendered(DIFF, 80)));
});

test("the changed words keep their stronger tint with highlighting on", () => {
  const rows = rendered("-1 const a = 1;\n+1 const a = 2;", 40, options, "typescript");
  assert.equal(tints(rows[0]).size, 2, "row tint and word tint on the removed row");
  assert.equal(tints(rows[1]).size, 2, "row tint and word tint on the added row");
});

test("the changed words of a removed/added pair get a stronger tint", () => {
  const rows = rendered(" 1 a\n-2 const a = 1;\n+2 const a = 2;", 40);
  assert.equal(tints(rows[1]).size, 2, "row tint and word tint on the removed row");
  assert.equal(tints(rows[2]).size, 2, "row tint and word tint on the added row");
});

test("a rewritten line gets the row tint only", () => {
  const rows = rendered("-1 alpha beta gamma\n+1 something else entirely", 60);
  for (const row of rows) assert.equal(tints(row).size, 1, JSON.stringify(row));
});

test("changed spans widen to whole words", () => {
  assert.deepEqual(changedSpan("const port = 3000;", "const port = 3001;"), { start: 13, endBefore: 17, endAfter: 17 });
  assert.deepEqual(changedSpan("a b", "a b c"), { start: 3, endBefore: 3, endAfter: 5 });
});

for (const width of [40, 100]) {
  test(`no row is wider than ${width} columns, cut or wrapped`, () => {
    const long = `-1 ${"x".repeat(150)}\n+1 ${"y".repeat(150)}`;
    const cut = rendered(long, width);
    assert.equal(cut.length, 2);
    const wrapped = rendered(long, width, { ...options, wrap: true });
    assert.ok(wrapped.length > 2, "long lines wrap when expanded");
    for (const row of [...cut, ...wrapped]) assert.ok(visibleWidth(row) <= width, JSON.stringify(row));
    assert.ok(plain(wrapped)[1].startsWith("   "), "a continuation row leaves the number and marker blank");
  });
}

test("a collapsed preview pairs each removed line with the line that replaced it", () => {
  const diff = ["  1 a", "- 2 b", "- 3 c", "- 4 d", "+ 2 B", "+ 3 C", "+ 4 D", "  5 e"].join("\n");
  assert.deepEqual(previewLines(diff, 3), ["- 2 b", "+ 2 B", "- 3 c"]);
});

test("a preview of a change near the end starts earlier so it still fills its rows", () => {
  const diff = ["  1 a", "  2 b", "  3 c", "- 4 d", "+ 4 D"].join("\n");
  assert.deepEqual(previewLines(diff, 3), ["  3 c", "- 4 d", "+ 4 D"]);
});
