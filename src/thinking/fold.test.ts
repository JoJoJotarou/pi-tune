import assert from "node:assert/strict";
import { test } from "node:test";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import { foldThinking } from "./fold.ts";

test("streaming keeps the header and the last two non-empty lines", () => {
  const markdown = "first thought\n\nsecond thought\nthird thought\nfourth thought";
  assert.equal(
    foldThinking(markdown, { isStreaming: true, elapsedMs: 1_200 }),
    "◆ Thinking 1.2s\n\nthird thought\n\nfourth thought",
  );
});

test("streaming with fewer than two lines keeps what it has", () => {
  assert.equal(foldThinking("only thought", { isStreaming: true, elapsedMs: 400 }), "◆ Thinking 0.4s\n\nonly thought");
});

test("streaming without a known start omits the elapsed time", () => {
  assert.equal(foldThinking("a\nb", { isStreaming: true }), "◆ Thinking\n\na\n\nb");
});

test("complete block reports duration and line count", () => {
  const markdown = "one\ntwo\n\nthree\nfour\nfive\nsix";
  assert.equal(foldThinking(markdown, { isStreaming: false, durationMs: 2_400 }), "◆ Thought 2.4s · 6 lines");
});

test("complete block without a known duration omits it", () => {
  assert.equal(foldThinking("one\ntwo\nthree", { isStreaming: false }), "◆ Thought · 3 lines");
});

test("a single line is singular", () => {
  assert.equal(foldThinking("one", { isStreaming: false, durationMs: 900 }), "◆ Thought 0.9s · 1 line");
});

test("blank-only input is returned unchanged", () => {
  assert.equal(foldThinking("\n\n  \n", { isStreaming: false }), "\n\n  \n");
  assert.equal(foldThinking("", { isStreaming: true, elapsedMs: 100 }), "");
});

test("the rendered streaming fold shows the tail lines on separate rows", () => {
  initTheme("dark", false);
  const folded = foldThinking("hidden thought\nvisible one\nvisible two", { isStreaming: true, elapsedMs: 500 });
  const rows = new Markdown(folded, 0, 0, getMarkdownTheme()).render(40).map((row) => stripTerminalSequences(row));
  const text = rows.map((row) => row.trim());
  assert.ok(
    text.some((row) => row.includes("◆ Thinking 0.5s")),
    rows.join("\n"),
  );
  const first = text.findIndex((row) => row.includes("visible one"));
  const second = text.findIndex((row) => row.includes("visible two"));
  assert.ok(first >= 0 && second > first, rows.join("\n"));
  assert.ok(!text.some((row) => row.includes("hidden thought")), rows.join("\n"));
});
