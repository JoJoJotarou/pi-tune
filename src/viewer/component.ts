import { copyToClipboard, highlightCode, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ViewerBlock } from "./blocks.ts";
import {
  blockLines,
  currentBlock,
  handleKey,
  initialViewerState,
  type ViewerKey,
  type ViewerState,
  visibleRange,
  withHeight,
} from "./state.ts";

const HINT = "↑↓ scroll · / search · y copy · [ ] prev/next · esc close";

function topBorder(theme: Theme, title: string, range: { first: number; last: number; total: number }, width: number) {
  const inner = Math.max(0, width - 2);
  const right = ` ${range.first}–${range.last}/${range.total} ─`;
  let left = `─ ${title} · ${range.total} lines `;
  if (visibleWidth(left) + visibleWidth(right) > inner) {
    const room = inner - visibleWidth(right) - 1;
    left = room > 0 ? `${truncateToWidth(left, room, "…")}─` : "";
  }
  const fill = "─".repeat(Math.max(0, inner - visibleWidth(left) - visibleWidth(right)));
  return theme.fg("border", `╭${truncateToWidth(left + fill + right, inner, "", true)}╮`);
}

function bottomBorder(theme: Theme, text: string, width: number) {
  const inner = Math.max(0, width - 2);
  let left = `─ ${text} `;
  if (visibleWidth(left) + 1 > inner) left = truncateToWidth(left, Math.max(0, inner - 1), "…");
  const fill = "─".repeat(Math.max(0, inner - visibleWidth(left) - 1));
  return theme.fg("border", `╰${truncateToWidth(`${left}${fill}─`, inner, "", true)}╯`);
}

function highlightMatches(theme: Theme, line: string, query: string): string {
  const needle = query.toLowerCase();
  const haystack = line.toLowerCase();
  let out = "";
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return out + line.slice(from);
    out += line.slice(from, at) + theme.style(line.slice(at, at + needle.length), { bg: theme.colors.accent });
    from = at + needle.length;
  }
}

export class ViewerComponent implements Component {
  private state: ViewerState;
  private readonly theme: Theme;
  private readonly done: () => void;
  private readonly requestRender: () => void;
  private readonly rows: number;

  constructor(theme: Theme, blocks: readonly ViewerBlock[], done: () => void, requestRender: () => void, rows: number) {
    this.theme = theme;
    this.done = done;
    this.requestRender = requestRender;
    this.rows = rows;
    this.state = initialViewerState(blocks, Math.max(1, Math.floor(rows * 0.8) - 2));
  }

  handleInput(data: string): void {
    const key = this.state.searchMode ? this.searchKey(data) : this.normalKey(data);
    if (key === undefined) return;
    this.state = handleKey(this.state, key);
    if (key === "copy" && this.state.copied) {
      const block = currentBlock(this.state);
      if (block) void copyToClipboard(block.body);
    }
    if (this.state.closed) {
      this.done();
      return;
    }
    this.requestRender();
  }

  private searchKey(data: string): ViewerKey | undefined {
    if (matchesKey(data, Key.escape)) return "escape";
    if (matchesKey(data, Key.enter)) return "enter";
    if (matchesKey(data, Key.backspace)) return "backspace";
    if (data.length === 1 && data >= " ") return `char:${data}`;
    return undefined;
  }

  private normalKey(data: string): ViewerKey | undefined {
    if (matchesKey(data, Key.escape)) return "escape";
    if (matchesKey(data, Key.up)) return "up";
    if (matchesKey(data, Key.down)) return "down";
    if (matchesKey(data, Key.pageUp)) return "pageUp";
    if (matchesKey(data, Key.pageDown)) return "pageDown";
    if (matchesKey(data, Key.home)) return "home";
    if (matchesKey(data, Key.end)) return "end";
    if (data === "/") return "search";
    if (data === "[") return "prevBlock";
    if (data === "]") return "nextBlock";
    if (data === "y") return "copy";
    if (data === "n") return "nextMatch";
    if (data === "N") return "prevMatch";
    return undefined;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const block = currentBlock(this.state);
    if (width <= 2 || !block) return [];
    const inner = width - 2;
    const lines = blockLines(block);
    const bodyRows = Math.min(lines.length, Math.max(1, Math.floor(this.rows * 0.8) - 2));
    this.state = withHeight(this.state, bodyRows);

    const highlighted = block.kind === "code" ? highlightCode(block.body, block.lang) : [];
    const searching = !this.state.searchMode && this.state.query !== "";
    const body: string[] = [];
    for (let row = 0; row < bodyRows; row++) {
      const line = lines[this.state.offset + row] ?? "";
      let styled: string;
      if (searching && line.toLowerCase().includes(this.state.query.toLowerCase())) {
        styled = highlightMatches(this.theme, line, this.state.query);
      } else if (block.kind === "code") {
        styled = highlighted[this.state.offset + row] ?? line;
      } else {
        styled = this.theme.fg("toolOutput", line);
      }
      body.push(this.theme.fg("border", "│") + truncateToWidth(styled, inner, "", true) + this.theme.fg("border", "│"));
    }

    const text = this.state.copied ? "copied" : this.state.searchMode ? `/${this.state.query}` : HINT;
    return [
      topBorder(this.theme, block.title, visibleRange(this.state), width),
      ...body,
      bottomBorder(this.theme, text, width),
    ];
  }
}
