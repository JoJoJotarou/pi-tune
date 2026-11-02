import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { modalBodyRows } from "../shared/frame.ts";
import type { ViewerBlock } from "./blocks.ts";
import { ViewerComponent } from "./component.ts";

initTheme("dark", false);

const plain = (line: string) => stripTerminalSequences(line);

const code: ViewerBlock = {
  kind: "code",
  title: "ts code",
  lang: "ts",
  body: Array.from({ length: 60 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n"),
};

function component(blocks: readonly ViewerBlock[], rows = 40, closed: () => void = () => {}) {
  return new ViewerComponent(testTheme("dark"), blocks, closed, () => {}, rows);
}

function render(width: number, rows = 40, block: ViewerBlock = code): string[] {
  return component([block], rows).render(width);
}

test("renders a modal frame with a title, range, and key hints", () => {
  const lines = render(60);

  assert.equal(lines.length, modalBodyRows(60, 40) + 2);
  assert.equal(plain(lines[0]).slice(0, 10), "╭─ ts code");
  assert.match(plain(lines[0]), /1–34\/60 ─╮$/);
  assert.match(plain(lines.at(-1) ?? ""), /╰─ ↑↓ scroll · \/ search · y copy/);
  assert.match(plain(lines[1]), /│ const value1 = 1;/);
  assert.match(plain(lines[1]), /│$/);
  for (const line of lines) assert.equal(visibleWidth(line), 60);
});

test("short content still opens a window at least 60% of the screen tall", () => {
  const short: ViewerBlock = { kind: "tool", title: "bash · seq 1 3", body: "1\n2\n3" };
  const lines = render(40, 40, short);

  assert.equal(lines.length, modalBodyRows(3, 40) + 2);
  assert.ok(lines.length >= Math.ceil(40 * 0.6), `${lines.length} rows`);
  assert.match(plain(lines[1]), /^│ 1\s+│$/);
  // Every remaining row is a framed blank row, not a hole.
  for (const line of lines.slice(4, -1)) assert.match(plain(line), /^│\s+│$/);
  for (const line of lines) assert.equal(visibleWidth(line), 40);
});

test("renders at width 30 without a line wider than the width", () => {
  const lines = render(30);

  assert.match(plain(lines[0]), /1–34\/60/);
  for (const line of lines) assert.equal(visibleWidth(line), 30);
});

test("scroll keys move the visible range", () => {
  const viewer = component([code]);
  viewer.render(60);
  viewer.handleInput("\x1b[B");
  assert.match(plain(viewer.render(60)[0]), /2–35\/60/);
});

test("searching shows the query in the hint slot and copy shows copied once", () => {
  const viewer = component([code]);
  viewer.render(60);
  viewer.handleInput("/");
  viewer.handleInput("v");
  viewer.handleInput("a");
  assert.match(plain(viewer.render(60).at(-1) ?? ""), /╰─ \/va ─+╯$/);
  viewer.handleInput("\x1b");
  assert.match(plain(viewer.render(60).at(-1) ?? ""), /↑↓ scroll/);

  viewer.handleInput("y");
  assert.match(plain(viewer.render(60).at(-1) ?? ""), /╰─ copied ─+╯$/);
  viewer.handleInput("\x1b[B");
  assert.match(plain(viewer.render(60).at(-1) ?? ""), /↑↓ scroll/);
});

test("tool output renders in the tool output color and escape closes", () => {
  let closed = 0;
  const tool: ViewerBlock = { kind: "tool", title: "bash · seq 1 3", body: "1\n2\n3" };
  const viewer = component([tool], 40, () => {
    closed++;
  });
  const lines = viewer.render(40);
  assert.match(plain(lines[0]), /bash · seq 1 3/);
  assert.match(plain(lines[1]), /│ 1 /);
  viewer.handleInput("\x1b");
  assert.equal(closed, 1);
});
