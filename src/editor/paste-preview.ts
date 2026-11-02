import { rawKeyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { frame, joinHints, modalBodyRows } from "../shared/frame.ts";
import { formatSize } from "./paste.ts";

export type PastePreviewAction = "expand" | "delete";

export class PastePreview implements Component {
  private readonly theme: Theme;
  private readonly id: number;
  private readonly content: string;
  private readonly rows: number;
  private readonly done: (action?: PastePreviewAction) => void;
  private scroll = 0;

  constructor(theme: Theme, id: number, content: string, rows: number, done: (action?: PastePreviewAction) => void) {
    this.theme = theme;
    this.id = id;
    this.content = content;
    this.rows = rows;
    this.done = done;
  }

  private wrapped(width: number): string[] {
    return wrapTextWithAnsi(this.content, Math.max(1, width - 4));
  }

  render(width: number): string[] {
    const lines = this.wrapped(width);
    const bodyRows = modalBodyRows(lines.length, this.rows);
    this.scroll = Math.min(this.scroll, Math.max(0, lines.length - bodyRows));
    const body = Array.from({ length: bodyRows }, (_, row) => lines[this.scroll + row] ?? "");
    const lineCount = this.content.split("\n").length;
    const size = formatSize(Buffer.byteLength(this.content, "utf8"));
    return frame(body, width, this.theme, {
      color: "borderAccent",
      title: this.theme.bold(this.theme.fg("accent", `paste #${this.id}`)),
      meta: this.theme.fg("dim", `${lineCount} lines · ${size}`),
      hints: joinHints(this.theme, [
        rawKeyHint("e", "expand"),
        rawKeyHint("d", "delete"),
        rawKeyHint("↑↓", "scroll"),
        rawKeyHint("esc", "close"),
      ]),
    });
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
    else if (matchesKey(data, "pageUp")) this.scroll = Math.max(0, this.scroll - this.rows);
    else if (matchesKey(data, "pageDown")) this.scroll += this.rows;
    else return;
  }

  invalidate(): void {}
}
