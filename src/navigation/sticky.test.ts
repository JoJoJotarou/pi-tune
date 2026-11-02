import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { StickyBar, stickyPrompt, stickyRows } from "./sticky.ts";

initTheme("dark", false);

function stickyTui(columns: number, questions = ["first question"]) {
  const chat: { children: Component[]; render: () => string[] } = {
    children: questions.map((question) => new UserMessageComponent(question)),
    render: () => [],
  };
  const document = {
    children: [{ render: () => [] }, { render: () => [] }, chat],
    render: () => [],
    addChild: () => {},
  };
  return {
    children: [document],
    terminal: { columns, rows: 30 },
    viewportTop: 5,
    scrollBy: () => {},
  };
}

const prompts = [
  { row: 0, text: "first question" },
  { row: 10, text: "second  question\nwith a break" },
  { row: 20, text: "third question" },
];

test("shows no sticky prompt before the first prompt", () => {
  assert.equal(stickyPrompt([{ row: 5, text: "first" }], 0), undefined);
  assert.equal(stickyPrompt([], 10), undefined);
});

test("shows no sticky prompt while a prompt row is the first visible row", () => {
  assert.equal(stickyPrompt(prompts, 0), undefined);
  assert.equal(stickyPrompt(prompts, 10), undefined);
  assert.equal(stickyPrompt(prompts, 20), undefined);
});

test("shows the prompt that owns the first visible row", () => {
  assert.deepEqual(stickyPrompt(prompts, 5), { index: 0, text: "first question" });
  assert.deepEqual(stickyPrompt(prompts, 15), { index: 1, text: "second  question\nwith a break" });
  assert.deepEqual(stickyPrompt(prompts, 60), { index: 2, text: "third question" });
});

const plain = (line: string) => stripTerminalSequences(line);

function textRows(prompt: { index: number; text: string }, width: number): string[] {
  // Drop the painted blank row above and below, which carry no text.
  return stickyRows(prompt, width, testTheme("dark")).slice(1, -1);
}

test("a one-line prompt renders one text row between two painted blank rows", () => {
  const theme = testTheme("dark");
  const rows = stickyRows({ index: 0, text: "first question" }, 40, theme);

  assert.equal(rows.length, 3);
  assert.equal(plain(rows[0]), " ".repeat(40));
  assert.equal(plain(rows[1]), ` first question${" ".repeat(40 - 1 - "first question".length - 1)} `);
  assert.equal(plain(rows[2]), " ".repeat(40));
  for (const row of rows) assert.equal(visibleWidth(row), 40);
});

test("the prompt keeps its own line breaks", () => {
  const rows = textRows({ index: 1, text: "second question\nwith a break" }, 40);

  assert.equal(rows.length, 2);
  assert.equal(plain(rows[0]).trim(), "second question");
  assert.equal(plain(rows[1]).trim(), "with a break");
});

test("a three-line prompt shows three rows and no ellipsis", () => {
  const rows = textRows({ index: 1, text: "one\ntwo\nthree" }, 40);

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => plain(row).trim()),
    ["one", "two", "three"],
  );
});

test("a five-line prompt keeps three rows and ends the third with an ellipsis", () => {
  const rows = textRows({ index: 1, text: "one\ntwo\nthree\nfour\nfive" }, 40);

  assert.equal(rows.length, 3);
  assert.equal(plain(rows[2]).trim(), "three …");
});

test("every row carries the user message background, at width 40", () => {
  const rows = stickyRows({ index: 0, text: "a question" }, 40, testTheme("dark"));
  const bg = testTheme("dark").bg("userMessageBg", "x").split("x")[0];

  for (const row of rows) {
    assert.equal(visibleWidth(row), 40);
    assert.ok(row.includes(bg), JSON.stringify(row));
  }
});

test("cuts a long prompt with an ellipsis instead of overflowing", () => {
  const text = Array.from({ length: 6 }, () => "a very long question that does not fit in forty columns").join(" ");
  const rows = stickyRows({ index: 2, text }, 40, testTheme("dark"));

  assert.equal(rows.length, 5);
  for (const row of rows) assert.ok(visibleWidth(row) <= 40, JSON.stringify(plain(row)));
  assert.ok(plain(rows[3]).trimEnd().endsWith("…"), JSON.stringify(plain(rows[3])));
});

const twoQuestions = ["first question", "second question"];

for (const [columns, questions, width] of [
  [80, twoQuestions, 78],
  [50, twoQuestions, 49],
  [80, ["first question"], 79],
] as const) {
  test(`leaves the rail or scrollbar columns free (${columns} columns, ${questions.length} prompts)`, () => {
    const bar = new StickyBar(
      stickyTui(columns, [...questions]) as never,
      () => testTheme("dark"),
      () => {},
    );

    const lines = bar.render(columns);

    assert.equal(lines.length, 3);
    for (const line of lines) assert.equal(visibleWidth(line), width);
  });
}

test("renders with the theme current at render time", () => {
  const themes = [testTheme("dark"), testTheme("light")];
  let current = 0;
  const bar = new StickyBar(
    stickyTui(80) as never,
    () => themes[current],
    () => {},
  );

  const before = bar.render(80);
  current = 1;
  const after = bar.render(80);

  assert.notDeepEqual(after, before);
});
