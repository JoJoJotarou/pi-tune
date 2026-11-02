import assert from "node:assert/strict";
import test from "node:test";
import type { ViewerBlock } from "./blocks.ts";
import {
  blockLines,
  currentBlock,
  handleKey,
  initialViewerState,
  type ViewerKey,
  type ViewerState,
  visibleRange,
} from "./state.ts";

function block(body: string, title = "block"): ViewerBlock {
  return { kind: "tool", title, body };
}

function lines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");
}

function press(state: ViewerState, ...keys: ViewerKey[]): ViewerState {
  return keys.reduce(handleKey, state);
}

function type(state: ViewerState, text: string): ViewerState {
  return press(state, ...[...text].map((char): ViewerKey => `char:${char}`));
}

test("scroll clamps to the block", () => {
  let state = initialViewerState([block(lines(10))], 4);
  state = press(state, "up");
  assert.equal(state.offset, 0);

  state = press(state, "down", "down", "down");
  assert.equal(state.offset, 3);
  state = press(state, "end");
  assert.equal(state.offset, 6);
  state = press(state, "down", "down");
  assert.equal(state.offset, 6);
  state = press(state, "home");
  assert.equal(state.offset, 0);
});

test("paging moves by one viewport and clamps", () => {
  let state = initialViewerState([block(lines(20))], 4);
  state = press(state, "pageDown");
  assert.equal(state.offset, 4);
  state = press(state, "pageDown");
  assert.equal(state.offset, 8);
  state = press(state, "pageUp");
  assert.equal(state.offset, 4);
  state = press(state, "pageDown", "pageDown", "pageDown", "pageDown");
  assert.equal(state.offset, 16);
});

test("block switching starts at the latest block and stops at the ends", () => {
  const blocks = [block("a", "a"), block("b", "b"), block("c", "c")];
  let state = initialViewerState(blocks, 3);
  assert.equal(currentBlock(state)?.title, "c");

  state = press(state, "nextBlock");
  assert.equal(state.index, 2);
  state = press(state, "prevBlock");
  assert.equal(state.index, 1);
  assert.equal(state.offset, 0);
  state = press(state, "prevBlock", "prevBlock");
  assert.equal(state.index, 0);
  assert.equal(currentBlock(state)?.title, "a");
});

test("switching blocks resets scroll and search", () => {
  const blocks = [block(lines(20), "a"), block(lines(20), "b")];
  let state = initialViewerState(blocks, 4);
  state = press(state, "end");
  state = press(state, "search");
  state = type(state, "line");
  state = press(state, "enter");
  assert.equal(state.searchMode, false);
  assert.equal(state.offset, 0);

  state = press(state, "prevBlock");
  assert.equal(state.index, 0);
  assert.equal(state.offset, 0);
  assert.equal(state.query, "");
  assert.deepEqual(state.matches, []);
});

test("search finds case-insensitive matches and n/N wrap around", () => {
  const body = ["alpha", "beta", "alpha two", "gamma", "alpha three"].join("\n");
  let state = initialViewerState([block(body)], 2);
  state = press(state, "search");
  assert.equal(state.searchMode, true);
  state = type(state, "ALPHA");
  assert.equal(state.query, "ALPHA");
  assert.deepEqual(state.matches, []);

  state = press(state, "enter");
  assert.equal(state.searchMode, false);
  assert.deepEqual(state.matches, [0, 2, 4]);
  assert.equal(state.matchIndex, 0);
  assert.equal(state.offset, 0);

  state = press(state, "nextMatch");
  assert.equal(state.matchIndex, 1);
  assert.equal(state.offset, 1);
  state = press(state, "nextMatch");
  assert.equal(state.matchIndex, 2);
  state = press(state, "nextMatch");
  assert.equal(state.matchIndex, 0);
  state = press(state, "prevMatch");
  assert.equal(state.matchIndex, 2);
});

test("enter jumps to the first match and centers it", () => {
  const body = Array.from({ length: 30 }, (_, index) => (index === 20 ? "needle" : `line ${index}`)).join("\n");
  let state = initialViewerState([block(body)], 6);
  state = press(state, "search");
  state = type(state, "needle");
  state = press(state, "enter");
  assert.deepEqual(state.matches, [20]);
  assert.equal(state.offset, 17);
  assert.deepEqual(visibleRange(state), { first: 18, last: 23, total: 30 });
});

test("escape leaves search first and closes second", () => {
  let state = initialViewerState([block(lines(5))], 3);
  state = press(state, "search");
  state = press(state, "escape");
  assert.equal(state.searchMode, false);
  assert.equal(state.closed, false);
  state = press(state, "escape");
  assert.equal(state.closed, true);
});

test("copy is cleared by the next key", () => {
  let state = initialViewerState([block(lines(5))], 3);
  state = press(state, "copy");
  assert.equal(state.copied, true);
  state = press(state, "down");
  assert.equal(state.copied, false);
});

test("visible range tracks the offset", () => {
  let state = initialViewerState([block(lines(10))], 4);
  assert.deepEqual(visibleRange(state), { first: 1, last: 4, total: 10 });
  state = press(state, "pageDown");
  assert.deepEqual(visibleRange(state), { first: 5, last: 8, total: 10 });
  assert.equal(blockLines(currentBlock(state)).length, 10);
});
