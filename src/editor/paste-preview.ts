import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { placeLeft } from "./border.ts";
import { formatSize } from "./paste.ts";

export type PastePreviewAction = "expand" | "delete";

const BODY_ROWS = 10;

export class PastePreview implements Component {
  private readonly theme: Theme;
  private readonly id: number;
  private readonly content: string;
  private readonly done: (action?: PastePreviewAction) => void;
  private scroll = 0;

  constructor(theme: Theme, id: number, content: string, done: (action?: PastePreviewAction) => void) {
    this.theme = theme;
    this.id = id;
    this.content = content;
    this.done = done;
  }

  private wrapped(width: number): string[] {
    return wrapTextWithAnsi(this.content, Math.max(1, width - 2));
  }

  private maxScroll(width: number): number {
    return Math.max(0, this.wrapped(width).length - BODY_ROWS);
  }

  render(width: number): string[] {
    const border = this.theme.fg("border", "─".repeat(Math.max(0, width)));
    const lines = this.wrapped(width);
    const lineCount = this.content.split("\n").length;
    const size = formatSize(Buffer.byteLength(this.content, "utf8"));
    this.scroll = Math.min(this.scroll, this.maxScroll(width));

    const body: string[] = [];
    for (let i = this.scroll; i < Math.min(lines.length, this.scroll + BODY_ROWS); i++) {
      body.push(truncateToWidth(`  ${lines[i]}`, width, ""));
    }

    return [
      placeLeft(border, this.theme.fg("accent", ` paste #${this.id} · ${lineCount} lines · ${size} `), width),
      ...body,
      placeLeft(border, this.theme.fg("muted", " e expand · d delete · esc close "), width),
    ];
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.done();
      return;
    }
    if (data === "e") {
      this.done("expand");
      return;
    }
    if (data === "d") {
      this.done("delete");
      return;
    }
    if (matchesKey(data, "up")) this.scroll = Math.max(0, this.scroll - 1);
    else if (matchesKey(data, "down")) this.scroll += 1;
    else if (matchesKey(data, "pageUp")) this.scroll = Math.max(0, this.scroll - BODY_ROWS);
    else if (matchesKey(data, "pageDown")) this.scroll += BODY_ROWS;
    else return;
  }

  invalidate(): void {}
}
