import assert from "node:assert/strict";
import { test } from "node:test";
import { Markdown, visibleWidth } from "@earendil-works/pi-tui";
import {
  buildThinkingWindow,
  clipToTailIndex,
  escapeMarkdownHooks,
  findCodeSpanEnd,
  hookAwareWidth,
  joinAllLines,
  stripUnpairedBackticks,
} from "./window.ts";

const ANSI_TRUE = true;

/** The core invariant: the output is exactly one line and never exceeds the width. */
function assertSingleLine(markdown: string, width: number, ansi = ANSI_TRUE): string {
  const line = buildThinkingWindow(markdown, width, visibleWidth, ansi);
  const lineBreak = /[\n\r\u2028\u2029]/;
  assert.ok(!lineBreak.test(line), "must not contain line breaks");
  assert.ok(visibleWidth(line) <= width, `width ${visibleWidth(line)} exceeds ${width}`);
  return line;
}

test("short thinking fits and keeps the label", () => {
  const line = assertSingleLine("step one and two", 80);
  assert.equal(line, "\x1b[23m◆ Think: \x1b[3mstep one and two");
});

test("overflow drops the head behind an ellipsis and keeps the tail", () => {
  const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" over\n");
  const line = assertSingleLine(text, 40);
  assert.ok(line.includes("…"));
  assert.ok(line.endsWith("word59"), "newest token must stay at the line end");
});

test("single line at width 40 with hostile content", () => {
  const markdown = [
    "## Heading with `code` and <angle>",
    "",
    "- list item `a\nb` spanning",
    "contact me at foo@example.com or see [docs](https://x.y) and array[0](weird)",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "中文段落接缝测试，标点。",
  ].join("\n");
  for (const width of [40, 80, 120]) assertSingleLine(markdown, width);
});

test("CJK folding joins without spaces; paragraph seams get a comma", () => {
  assert.equal(joinAllLines(["第一段结尾", "第二段开头"]), "第一段结尾第二段开头");
  assert.equal(joinAllLines(["第一段结尾", "", "第二段开头"]), "第一段结尾，第二段开头");
  assert.equal(joinAllLines([" english words", "continue here"]), "english words continue here");
  assert.equal(joinAllLines(["中文接缝", "直接相连"]), "中文接缝直接相连");
});

test("paragraph seam does not double up existing punctuation", () => {
  assert.equal(joinAllLines(["结束了。", "", "下一段"]), "结束了。下一段");
});

test("unpaired backticks are stripped, paired spans survive", () => {
  assert.equal(stripUnpairedBackticks("a `b c"), "a b c");
  assert.equal(stripUnpairedBackticks("a `b c` d"), "a `b c` d");
  assert.equal(stripUnpairedBackticks("a ```b` c`` d"), "a b c d");
  assert.equal(findCodeSpanEnd("x `a b` y", 2), 7);
  assert.equal(findCodeSpanEnd("x `a b", 2), -1);
});

test("escaping @ and unpaired ] is idempotent and skips URLs and code spans", () => {
  assert.equal(escapeMarkdownHooks("mail me a@b.com"), "mail me a\\@b.com");
  assert.equal(escapeMarkdownHooks("see https://user:pass@host/x"), "see https://user:pass@host/x");
  assert.equal(escapeMarkdownHooks("arr[0] ok"), "arr[0] ok");
  assert.equal(escapeMarkdownHooks("trailing ]("), "trailing \\](");
  assert.equal(escapeMarkdownHooks("keep `a@b` span"), "keep `a@b` span");
  assert.equal(escapeMarkdownHooks(escapeMarkdownHooks("a@b.com")), escapeMarkdownHooks("a@b.com"));
});

test("hookAwareWidth accounts for escapes; plain text equals visibleWidth", () => {
  assert.equal(hookAwareWidth("plain", visibleWidth), visibleWidth("plain"));
  assert.equal(hookAwareWidth("a@b", visibleWidth), visibleWidth("a@b") + 1);
});

test("clipToTailIndex keeps the tail within budget", () => {
  const text = "abcdefgh";
  const from = clipToTailIndex(text, 5, visibleWidth);
  assert.equal(visibleWidth(text.slice(from)), 4); // 5 minus the ellipsis column
  assert.equal(clipToTailIndex(text, 100, visibleWidth), 0);
});

test("no ANSI when disabled", () => {
  const line = buildThinkingWindow("hello", 80, visibleWidth, false);
  assert.equal(line, "◆ Think: hello");
  assert.ok(!line.includes("\x1b"));
});

test("narrow terminal keeps content and drops the label", () => {
  const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join("");
  const line = assertSingleLine(long, 10);
  assert.ok(!line.includes("Think: "));
  assert.ok(line.startsWith("…"));
  assert.ok(line.endsWith("w29"));
});

test("empty thinking renders unchanged", () => {
  assert.equal(buildThinkingWindow("   \n\n  ", 80, visibleWidth), "   \n\n  ");
});

test("right inset keeps the line off the right edge", () => {
  const text = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
  const line = assertSingleLine(text, 80);
  assert.ok(visibleWidth(line) <= 80 - 3);
});

const noopTheme = {
  heading: (t: string) => t,
  link: (t: string) => t,
  linkUrl: (t: string) => t,
  code: (t: string) => t,
  codeBlock: (t: string) => t,
  codeBlockBorder: (t: string) => t,
  quote: (t: string) => t,
  quoteBorder: (t: string) => t,
  hr: (t: string) => t,
  listBullet: (t: string) => t,
  bold: (t: string) => t,
  italic: (t: string) => t,
  strikethrough: (t: string) => t,
  underline: (t: string) => t,
};

/** True rendering invariant for multi-line windows: markdown re-parse must not merge or widen rows. */
function renderedRows(markdown: string, width: number, maxLines: number): string[] {
  const output = buildThinkingWindow(markdown, width, visibleWidth, false, maxLines);
  const md = new Markdown(output, 0, 0, noopTheme);
  return md
    .render(width)
    .map((row) => row.trimEnd())
    .filter((row) => row !== "");
}

function assertBoundedRows(markdown: string, width: number, maxLines: number): string[] {
  const rows = renderedRows(markdown, width, maxLines);
  assert.ok(rows.length <= maxLines, `expected ≤ ${maxLines} rows, got ${rows.length}:\n${rows.join("\n")}`);
  for (const row of rows) {
    assert.ok(visibleWidth(row) <= width, `row width ${visibleWidth(row)} exceeds ${width}: ${row}`);
  }
  return rows;
}

function multiMarkdown(): string {
  return [
    "## Heading with `code` and <angle>",
    "",
    "- list item `a\nb` spanning",
    "contact foo@example.com and [docs](https://x.y) plus array[0](weird)",
    "",
    "中文段落接缝测试,多行窗口的宽度与行数都要稳。",
  ].join("\n");
}

function multiCjk(): string {
  const sentence = "先读一遍需求,确认改动范围只在渲染层。超出预算时从头部丢弃,行尾永远是最新写下的内容。";
  return `${Array.from({ length: 5 }, () => sentence).join("\n\n")}这一句必须留在最后一行。`;
}

for (const width of [40, 80, 120]) {
  for (const source of [multiMarkdown(), multiCjk()]) {
    test(`multi-line window holds ≤4 rows at width ${width} (${source.slice(0, 6)}…)`, () => {
      const rows = assertBoundedRows(source, width, 4);
      assert.ok(rows[0].includes("◆ Think:"), `label row expected:\n${rows.join("\n")}`);
    });
  }
}

test("multi-line window shows the tail and the hidden count", () => {
  const rows = assertBoundedRows(multiCjk(), 40, 4);
  assert.ok(rows[rows.length - 1].endsWith("。"), `newest text stays at the tail:\n${rows.join("\n")}`);
  const head = rows[0];
  assert.match(head, /\+\d+ lines/);
});

test("multi-line window without overflow shows every row and no count", () => {
  const rows = assertBoundedRows("short thought", 80, 4);
  assert.equal(rows.length, 2);
  assert.ok(!rows[0].includes("+"));
  assert.equal(rows[1], "short thought");
});
