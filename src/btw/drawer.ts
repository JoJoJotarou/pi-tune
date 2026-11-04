import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { drawerMaxHeight, renderBtw } from "./render.ts";
import type { BtwThread } from "./thread.ts";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
export const SPINNER_INTERVAL_MS = 80;

export interface DrawerView {
  /** The drawer is open exactly while btw mode is on. */
  open: boolean;
  thread: BtwThread | null;
  number: number;
  mainTurns: number;
  pending?: { question: string; answer: string; startedAt: number };
  /** Bumped by the owner on every change to the fields above. */
  revision: number;
}

export interface DrawerOptions {
  view: () => DrawerView;
  theme: Theme;
  terminalRows: () => number;
  now?: () => number;
}

/** The btw widget above the editor: the drawer plus its scroll position. */
export class Drawer implements Component {
  private readonly options: DrawerOptions;
  /** First body row on screen; undefined follows the newest row. */
  private top?: number;
  private maxTop = 0;
  private pageRows = 1;
  private cache?: { key: string; lines: string[] };

  constructor(options: DrawerOptions) {
    this.options = options;
  }

  render(width: number): string[] {
    const view = this.options.view();
    if (!view.open) return [];
    const elapsedMs = view.pending ? (this.options.now ?? Date.now)() - view.pending.startedAt : 0;
    const spinner = SPINNER[Math.floor(elapsedMs / SPINNER_INTERVAL_MS) % SPINNER.length];
    const maxHeight = drawerMaxHeight(this.options.terminalRows());
    const tick = view.pending ? `${spinner}${Math.floor(elapsedMs / 100)}` : "";
    const key = [width, maxHeight, this.top ?? "end", view.revision, tick].join("|");
    if (this.cache?.key === key) return this.cache.lines;

    const output = renderBtw({
      thread: view.thread,
      number: view.number,
      mainTurns: view.mainTurns,
      ...(view.pending
        ? { pending: { question: view.pending.question, answer: view.pending.answer, elapsedMs, spinner } }
        : {}),
      ...(this.top === undefined ? {} : { top: this.top }),
      maxHeight,
      width,
      theme: this.options.theme,
      markdown: getMarkdownTheme(),
    });
    this.maxTop = output.maxTop;
    this.pageRows = output.pageRows;
    if (this.top !== undefined) this.top = output.top;
    this.cache = { key, lines: output.lines };
    return output.lines;
  }

  invalidate(): void {
    this.cache = undefined;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "wheel" || !event.wheelDelta) return undefined;
    this.scrollBy(event.wheelDelta);
    return { handled: true };
  }

  /** One page up (-1) or down (1), keeping one row of the previous page in view. */
  page(direction: -1 | 1): void {
    this.scrollBy(direction * Math.max(1, this.pageRows - 1));
  }

  /** Back to the newest row, e.g. after asking or switching threads. */
  follow(): void {
    this.top = undefined;
    this.cache = undefined;
  }

  private scrollBy(rows: number): void {
    const next = (this.top ?? this.maxTop) + rows;
    this.top = next >= this.maxTop ? undefined : Math.max(0, next);
    this.cache = undefined;
  }
}
