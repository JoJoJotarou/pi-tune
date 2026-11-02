import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { type Component, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { StickyBar, stickyLine, stickyPrompt } from "./sticky.ts";

initTheme("dark", false);

function stickyTui(columns: number) {
  const chat: { children: Component[]; render: () => string[] } = {
    children: [new UserMessageComponent("first question")],
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

test("formats the sticky line at width 80", () => {
  const theme = testTheme("dark");
  const line = stickyLine({ index: 1, text: "second  question\nwith a break" }, 80, theme);

  assert.equal(visibleWidth(line), 80);
  const text = stripTerminalSequences(line);
  assert.ok(text.startsWith("› second question with a break · prompt 2"), text);
});

test("cuts a long sticky line with an ellipsis at width 30", () => {
  const theme = testTheme("dark");
  const line = stickyLine({ index: 2, text: "a very long question that does not fit" }, 30, theme);

  assert.equal(visibleWidth(line), 30);
  const text = stripTerminalSequences(line);
  assert.ok(text.startsWith("› a very long question"), text);
  assert.ok(text.endsWith("…"), text);
});

test("leaves the last column free for the rail", () => {
  const bar = new StickyBar(
    stickyTui(80) as never,
    () => testTheme("dark"),
    () => {},
  );

  const lines = bar.render(80);

  assert.equal(lines.length, 1);
  assert.equal(visibleWidth(lines[0]), 79);
});

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
