import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import { readEditorPaste } from "../internals/editor-pastes.ts";
import { placeLeft, placeRight } from "./border.ts";
import { isLargePaste, markerAt, type PasteMarker, removeMarker, replaceMarker } from "./paste.ts";

export interface TuneEditorOptions {
  model: string;
  thinking: string;
  onPreview?: (id: number) => void;
}

interface Stash {
  text: string;
  line: number;
  col: number;
}

export class TuneEditor extends CustomEditor {
  private model: string;
  private thinking: string;
  private readonly onPreview?: (id: number) => void;
  private stash?: Stash;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options: TuneEditorOptions) {
    super(tui, theme, keybindings);
    this.model = options.model;
    this.thinking = options.thinking;
    this.onPreview = options.onPreview;
  }

  setStatus(model: string, thinking: string): void {
    this.model = model;
    this.thinking = thinking;
  }

  /** Ctrl+V reaches this path; route large text through the bracketed paste so it collapses like Cmd+V. */
  insertTextAtCursor(text: string): void {
    if (isLargePaste(text)) {
      super.handleInput(`\x1b[200~${text}\x1b[201~`);
      return;
    }
    super.insertTextAtCursor(text);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "ctrl+s")) {
      this.toggleStash();
      return;
    }
    if (data === "\r" || data === "\n" || matchesKey(data, "enter")) {
      const marker = this.markerAtCursor();
      if (marker) {
        this.onPreview?.(marker.id);
        return;
      }
    }
    super.handleInput(data);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    const result = super.handleMouse(event);
    if (event.clickCount === 2) {
      const marker = this.markerAtCursor();
      if (marker) this.onPreview?.(marker.id);
    }
    return result;
  }

  readPaste(id: number): string | Error {
    return readEditorPaste(this, id);
  }

  expandMarker(id: number, content: string): void {
    this.setText(replaceMarker(this.getText(), id, content));
    this.tui.requestRender();
  }

  deleteMarker(id: number): void {
    this.setText(removeMarker(this.getText(), id));
    this.tui.requestRender();
  }

  protected renderBottomBorder(width: number, hiddenLineCount: number): string {
    let border = super.renderBottomBorder(width, hiddenLineCount);
    if (this.stash) border = placeLeft(border, this.borderColor(" stashed "), width);
    return placeRight(border, this.borderColor(` ${this.model} · ${this.thinking} `), width);
  }

  private markerAtCursor(): PasteMarker | undefined {
    const text = this.getText();
    const { line, col } = this.getCursor();
    const lines = text.split("\n");
    let offset = 0;
    for (let i = 0; i < line && i < lines.length; i++) offset += lines[i].length + 1;
    offset += col;
    return markerAt(text, offset);
  }

  private toggleStash(): void {
    if (this.getText().length > 0) {
      const { line, col } = this.getCursor();
      this.stash = { text: this.getExpandedText(), line, col };
      this.setText("");
      this.tui.requestRender();
      return;
    }
    const stash = this.stash;
    if (!stash) return;
    this.stash = undefined;
    this.setText(stash.text);
    this.restoreCursor(stash.line, stash.col);
    this.tui.requestRender();
  }

  private restoreCursor(line: number, col: number): void {
    const lastLine = this.getText().split("\n").length - 1;
    for (let i = 0; i < lastLine; i++) super.handleInput("\x1b[A");
    super.handleInput("\x01");
    for (let i = 0; i < line; i++) super.handleInput("\x1b[B");
    for (let i = 0; i < col; i++) super.handleInput("\x1b[C");
  }
}
