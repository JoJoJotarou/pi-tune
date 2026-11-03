import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { grepBody, listBody, treeRows } from "./tree.ts";

initTheme("dark");

const theme = testTheme();

function plain(lines: string[]): string[] {
  return lines.map(stripTerminalSequences);
}

function assertFits(lines: string[], width: number): void {
  for (const line of plain(lines)) assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
}

test("tree rows draw a connector and the last child under three spaces", () => {
  const rows = plain(
    treeRows(
      [
        { text: "src/a.ts", children: [{ text: "1  const x = 1" }, { text: "40  foo()" }] },
        { text: "src/b.ts", children: [{ text: "3  bar" }] },
      ],
      100,
      theme,
    ),
  );
  assert.deepEqual(rows, ["├─ src/a.ts", "│  ├─ 1  const x = 1", "│  └─ 40  foo()", "└─ src/b.ts", "   └─ 3  bar"]);
});

test("tree connectors are dim and the row text keeps its own styling", () => {
  const [raw] = treeRows([{ text: theme.fg("accent", "src/a.ts") }], 100, theme);
  assert.ok(raw.startsWith(theme.fg("dim", "└─ ")), JSON.stringify(raw));
  assert.ok(raw.includes(theme.fg("accent", "src/a.ts")), JSON.stringify(raw));
});

test("tree rows cut every row to the width", () => {
  const items = [
    { text: "x".repeat(80), children: [{ text: "y".repeat(80) }, { text: "z".repeat(80) }] },
    { text: "w".repeat(80) },
  ];
  for (const width of [40, 100]) {
    const rows = treeRows(items, width, theme);
    assert.equal(rows.length, 4);
    assertFits(rows, width);
  }
});

test("ls entries are one row each, directories in accent, and the note after a blank row", () => {
  const text = "src/\nREADME.md\n\n[1 entries limit reached. Use limit=2 for more]";
  const rows = listBody(text, 100, theme);
  assert.deepEqual(plain(rows), ["├─ src/", "└─ README.md", "", "[1 entries limit reached. Use limit=2 for more]"]);
  assert.ok(rows[0].includes(theme.fg("accent", "src/")), JSON.stringify(rows[0]));
  assert.ok(rows[1].includes(theme.fg("toolOutput", "README.md")), JSON.stringify(rows[1]));
  assert.ok(rows[3].includes(theme.fg("dim", "[1 entries limit reached. Use limit=2 for more]")));
  for (const width of [40, 100]) assertFits(listBody(text, width, theme), width);
});

test("find results are one row each and a note keeps no connector", () => {
  const rows = listBody("src/a.ts\nsrc/b.ts", 40, theme);
  assert.deepEqual(plain(rows), ["├─ src/a.ts", "└─ src/b.ts"]);
  assert.deepEqual(plain(listBody("No files found matching pattern", 40, theme)), ["No files found matching pattern"]);
  assert.deepEqual(plain(listBody("(empty directory)", 40, theme)), ["(empty directory)"]);
});

test("ls entries that are wider than the row are cut", () => {
  const long = `${"deep/".repeat(20)}file.ts`;
  const rows = listBody(long, 40, theme);
  assert.equal(rows.length, 1);
  assertFits(rows, 40);
  assert.ok(plain(rows)[0].startsWith("└─ deep/deep/"), plain(rows)[0]);
});

test("grep groups match and context rows by file, in output order", () => {
  const text = ["src/a.ts:12: const x = 1", "src/a.ts-13- context", "src/a.ts:40: foo()", "src/b.ts:3: bar"].join("\n");
  const rows = grepBody(text, 100, theme);
  assert.deepEqual(plain(rows), [
    "├─ src/a.ts",
    "│  ├─ 12  const x = 1",
    "│  ├─ 13  context",
    "│  └─ 40  foo()",
    "└─ src/b.ts",
    "   └─ 3  bar",
  ]);
  assert.ok(rows[0].includes(theme.fg("accent", "src/a.ts")), JSON.stringify(rows[0]));
  assert.ok(rows[1].includes(theme.fg("dim", "12")), JSON.stringify(rows[1]));
  assert.ok(rows[1].includes(theme.fg("toolOutput", "const x = 1")), JSON.stringify(rows[1]));
  assert.ok(rows[2].includes(theme.fg("dim", "context")), JSON.stringify(rows[2]));
});

test("grep context rows of a file named like a date stay under that file", () => {
  const text = ["notes/2024-01-report.md:5: total", "notes/2024-01-report.md-6- context"].join("\n");
  assert.deepEqual(plain(grepBody(text, 100, theme)), [
    "└─ notes/2024-01-report.md",
    "   ├─ 5  total",
    "   └─ 6  context",
  ]);
});

test("grep right-aligns line numbers within a file so the text lines up", () => {
  const text = ["a.ts:2: const PORT = 3000;", "a.ts:26: listen(PORT);"].join("\n");
  assert.deepEqual(plain(grepBody(text, 100, theme)), [
    "└─ a.ts",
    "   ├─  2  const PORT = 3000;",
    "   └─ 26  listen(PORT);",
  ]);
});

test("grep shows each line once when context windows overlap, and a match wins over context", () => {
  // Pi prints the context of every match on its own, so neighbouring matches repeat lines.
  const text = [
    "a.ts-25- one",
    "a.ts:26: two",
    "a.ts-27- three",
    "a.ts-26- two",
    "a.ts:27: three",
    "a.ts-28- four",
  ].join("\n");
  const rows = grepBody(text, 100, theme);
  assert.deepEqual(plain(rows), ["└─ a.ts", "   ├─ 25  one", "   ├─ 26  two", "   ├─ 27  three", "   └─ 28  four"]);
  assert.ok(rows[3].includes(theme.fg("toolOutput", "three")), "line 27 is a match");
  assert.ok(rows[1].includes(theme.fg("dim", "one")), "line 25 stays context");
});

test("grep keeps lines that do not parse as rows under the file before them", () => {
  const text = ["before any file", "src/a.ts:1: match", "not a row", "src/b.ts:2: other"].join("\n");
  assert.deepEqual(plain(grepBody(text, 100, theme)), [
    "├─ before any file",
    "├─ src/a.ts",
    "│  ├─ 1  match",
    "│  └─ not a row",
    "└─ src/b.ts",
    "   └─ 2  other",
  ]);
});

test("grep keeps the note after a blank row, dim and without a connector", () => {
  const text = "src/a.ts:1: bar\n\n[1 matches limit reached. Use limit=2 for more, or refine pattern]";
  const rows = grepBody(text, 100, theme);
  assert.deepEqual(plain(rows), [
    "└─ src/a.ts",
    "   └─ 1  bar",
    "",
    "[1 matches limit reached. Use limit=2 for more, or refine pattern]",
  ]);
  assert.ok(rows[3].includes(theme.fg("dim", "[1 matches limit reached. Use limit=2 for more, or refine pattern]")));
});

test("grep and list bodies never exceed widths 40 and 100", () => {
  const grep = [
    `${"src/".repeat(20)}a.ts:1: ${"x".repeat(90)}`,
    `${"src/".repeat(20)}a.ts-2- ${"y".repeat(90)}`,
    `${"src/".repeat(20)}b.ts:3: ${"z".repeat(90)}`,
  ].join("\n");
  const list = ["dir/".repeat(30), "file-".repeat(30)].join("\n");
  for (const width of [40, 100]) {
    assertFits(grepBody(grep, width, theme), width);
    assertFits(listBody(list, width, theme), width);
  }
});

test("an empty result body has no rows and no matches keeps its text", () => {
  assert.deepEqual(grepBody("No matches found", 100, theme).map(stripTerminalSequences), ["No matches found"]);
  assert.deepEqual(grepBody("", 100, theme), []);
});
