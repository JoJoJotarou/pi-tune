import assert from "node:assert/strict";
import { test } from "node:test";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import { thinkingHeader } from "./header.ts";

test("a finished block reports duration and line count above the full text", () => {
  const markdown = "one\ntwo\n\nthree\nfour\nfive\nsix";
  assert.equal(
    thinkingHeader(markdown, { isStreaming: false, durationMs: 3_200 }),
    "◆ Thought 3.2s · 6 lines\n\none\ntwo\n\nthree\nfour\nfive\nsix",
  );
});

test("a streaming block reports the elapsed time", () => {
  assert.equal(
    thinkingHeader("first\nsecond", { isStreaming: true, elapsedMs: 3_200 }),
    "◆ Thinking 3.2s\n\nfirst\nsecond",
  );
});

test("a single line is singular", () => {
  assert.equal(thinkingHeader("one", { isStreaming: false, durationMs: 900 }), "◆ Thought 0.9s · 1 line\n\none");
});

test("an unknown duration is omitted", () => {
  assert.equal(thinkingHeader("one\ntwo", { isStreaming: false }), "◆ Thought · 2 lines\n\none\ntwo");
  assert.equal(thinkingHeader("one", { isStreaming: true }), "◆ Thinking\n\none");
});

test("blank-only input is returned unchanged", () => {
  assert.equal(thinkingHeader("\n\n  \n", { isStreaming: false, durationMs: 100 }), "\n\n  \n");
  assert.equal(thinkingHeader("", { isStreaming: true, elapsedMs: 100 }), "");
});

test("the rendered block shows the header above every thinking line", () => {
  initTheme("dark", false);
  const header = thinkingHeader("first thought\nsecond thought\nthird thought", {
    isStreaming: false,
    durationMs: 2_400,
  });
  const text = new Markdown(header, 0, 0, getMarkdownTheme())
    .render(40)
    .map((row) => stripTerminalSequences(row).trim());
  assert.equal(text[0], "◆ Thought 2.4s · 3 lines");
  for (const line of ["first thought", "second thought", "third thought"]) {
    assert.ok(text.includes(line), text.join("\n"));
  }
});
