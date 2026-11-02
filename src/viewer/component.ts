import { copyToClipboard, highlightCode, rawKeyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey } from "@earendil-works/pi-tui";
import { frame, joinHints, modalBodyRows } from "../shared/frame.ts";
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
    this.state = initialViewerState(blocks, modalBodyRows(1, rows));
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

  private hintLine(): string {
    if (this.state.copied) return this.theme.fg("dim", "copied");
    if (this.state.searchMode) return this.theme.fg("dim", `/${this.state.query}`);
    return joinHints(this.theme, [
      rawKeyHint("↑↓", "scroll"),
      rawKeyHint("/", "search"),
      rawKeyHint("y", "copy"),
      rawKeyHint("[ ]", "prev/next"),
      rawKeyHint("esc", "close"),
    ]);
  }

  render(width: number): string[] {
    const block = currentBlock(this.state);
    if (!block) return [];
    const lines = blockLines(block);
    const bodyRows = modalBodyRows(lines.length, this.rows);
    this.state = withHeight(this.state, bodyRows);

    const highlighted = block.kind === "code" ? highlightCode(block.body, block.lang) : [];
    const searching = !this.state.searchMode && this.state.query !== "";
    const body: string[] = [];
    for (let row = 0; row < bodyRows; row++) {
      const line = lines[this.state.offset + row] ?? "";
      if (searching && line.toLowerCase().includes(this.state.query.toLowerCase())) {
        body.push(highlightMatches(this.theme, line, this.state.query));
      } else if (block.kind === "code") {
        body.push(highlighted[this.state.offset + row] ?? line);
      } else {
        body.push(this.theme.fg("toolOutput", line));
      }
    }

    const range = visibleRange(this.state);
    return frame(body, width, this.theme, {
      color: "borderAccent",
      title: this.theme.bold(this.theme.fg("accent", block.title)),
      meta: this.theme.fg("dim", `${range.first}–${range.last}/${range.total}`),
      hints: this.hintLine(),
    });
  }
}
