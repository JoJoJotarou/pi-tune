import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
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
  const lineBreak = new RegExp("[\\n\\r\\u0085\\u000b\\u000c\\u2028\\u2029]");
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
