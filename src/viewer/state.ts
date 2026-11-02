import type { ViewerBlock } from "./blocks.ts";

export type ViewerKey =
  | "up"
  | "down"
  | "pageUp"
  | "pageDown"
  | "home"
  | "end"
  | "prevBlock"
  | "nextBlock"
  | "copy"
  | "escape"
  | "enter"
  | "search"
  | "nextMatch"
  | "prevMatch"
  | "backspace"
  | `char:${string}`;

export interface ViewerState {
  blocks: readonly ViewerBlock[];
  index: number;
  offset: number;
  height: number;
  query: string;
  searchMode: boolean;
  matches: readonly number[];
  matchIndex: number;
  copied: boolean;
  closed: boolean;
}

export function currentBlock(state: ViewerState): ViewerBlock | undefined {
  return state.blocks[state.index];
}

export function blockLines(block: ViewerBlock | undefined): string[] {
  return block ? block.body.split("\n") : [];
}

export function maxOffset(state: ViewerState): number {
  return Math.max(0, blockLines(currentBlock(state)).length - state.height);
}

export function visibleRange(state: ViewerState): { first: number; last: number; total: number } {
  const total = blockLines(currentBlock(state)).length;
  return {
    first: total === 0 ? 0 : Math.min(state.offset + 1, total),
    last: Math.min(state.offset + state.height, total),
    total,
  };
}

export function initialViewerState(blocks: readonly ViewerBlock[], height: number): ViewerState {
  return {
    blocks,
    index: Math.max(0, blocks.length - 1),
    offset: 0,
    height: Math.max(1, height),
    query: "",
    searchMode: false,
    matches: [],
    matchIndex: 0,
    copied: false,
    closed: false,
  };
}

export function withHeight(state: ViewerState, height: number): ViewerState {
  const next = { ...state, height: Math.max(1, height) };
  return { ...next, offset: Math.min(state.offset, maxOffset(next)) };
}

function clampOffset(state: ViewerState, offset: number): ViewerState {
  return { ...state, offset: Math.max(0, Math.min(offset, maxOffset(state))) };
}

function matchOffset(state: ViewerState, line: number): ViewerState {
  return clampOffset(state, line - Math.floor(state.height / 2));
}

function resetBlockState(state: ViewerState, index: number): ViewerState {
  return {
    ...state,
    index,
    offset: 0,
    query: "",
    searchMode: false,
    matches: [],
    matchIndex: 0,
    copied: false,
  };
}

function commitSearch(state: ViewerState): ViewerState {
  const query = state.query;
  const needle = query.toLowerCase();
  const matches = blockLines(currentBlock(state))
    .map((line, index) => (needle !== "" && line.toLowerCase().includes(needle) ? index : -1))
    .filter((index) => index >= 0);
  const next: ViewerState = { ...state, searchMode: false, matches, matchIndex: 0, copied: false };
  return matches.length === 0 ? { ...next, offset: state.offset } : matchOffset(next, matches[0]);
}

function jumpToMatch(state: ViewerState, delta: number): ViewerState {
  if (state.matches.length === 0) return state;
  const matchIndex = (state.matchIndex + delta + state.matches.length) % state.matches.length;
  return matchOffset({ ...state, matchIndex }, state.matches[matchIndex]);
}

function searchKey(state: ViewerState, key: ViewerKey): ViewerState {
  const next = { ...state, copied: false };
  if (key === "escape") return { ...next, searchMode: false, query: "", matches: [], matchIndex: 0 };
  if (key === "enter") return commitSearch(next);
  if (key === "backspace") return { ...next, query: state.query.slice(0, -1) };
  if (key.startsWith("char:")) return { ...next, query: state.query + key.slice("char:".length) };
  return state;
}

export function handleKey(state: ViewerState, key: ViewerKey): ViewerState {
  if (state.closed) return state;
  if (state.searchMode) return searchKey(state, key);

  const next = { ...state, copied: key === "copy" };
  switch (key) {
    case "escape":
      return { ...next, closed: true };
    case "copy":
      return next;
    case "search":
      return { ...next, searchMode: true, query: "", matches: [], matchIndex: 0, copied: false };
    case "up":
      return clampOffset(next, state.offset - 1);
    case "down":
      return clampOffset(next, state.offset + 1);
    case "pageUp":
      return clampOffset(next, state.offset - state.height);
    case "pageDown":
      return clampOffset(next, state.offset + state.height);
    case "home":
      return clampOffset(next, 0);
    case "end":
      return clampOffset(next, maxOffset(state));
    case "prevBlock":
      return state.index <= 0 ? next : resetBlockState(next, state.index - 1);
    case "nextBlock":
      return state.index >= state.blocks.length - 1 ? next : resetBlockState(next, state.index + 1);
    case "nextMatch":
      return jumpToMatch(next, 1);
    case "prevMatch":
      return jumpToMatch(next, -1);
    default:
      return next;
  }
}
