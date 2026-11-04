import { CustomEditor, type KeybindingsManager, type Theme, type ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  type EditorTheme,
  getKeybindings,
  matchesKey,
  sliceByColumn,
  stripTerminalSequences,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { readEditorPaste } from "../internals/editor-pastes.ts";
import { frameBottom, frameRow, frameTop } from "../shared/frame.ts";
import { isLargePaste, markerAt, type PasteMarker, removeMarker, replaceMarker } from "./paste.ts";
import { withGhostSuggestion } from "./suggestion.ts";

const STASH_CONFIRM_MS = 3000;
/** Zero-width APC: Pi pads every content line, so the bottom border needs its own tag to stay findable. */
const BOTTOM_MARK = "\u001b_pi:tune-bottom\u0007";

export interface TuneEditorOptions {
  model: string;
  thinking: string;
  /** Full theme for tokens the editor factory does not receive (`warning`). */
  theme: () => Theme;
  paddingX?: number;
  autocompleteMaxVisible?: number;
  onPreview?: (id: number) => void;
  /** Injected clock so tests can run the stash confirmation window without waiting. */
  now?: () => number;
  /** Runs before every submit, including commands that start no agent run. */
  onBeforeSubmit?: () => void;
  /** Runs when tab fills the editor with the suggestion. */
  onAcceptSuggestion?: () => void;
}

interface Stash {
  text: string;
  line: number;
  col: number;
}

export interface EditorBorderLabels {
  /** Title on the top border, e.g. Pi's working status. */
  top?: string;
  left?: string;
  right?: string;
}

/**
 * The frame helpers take a full `Theme`, but the editor only gets an `EditorTheme`. Border glyphs must keep Pi's
 * own editor border color (the thinking level), so every `fg` call goes through `borderColor`.
 */
function borderTheme(borderColor: (text: string) => string): Theme {
  return { fg: (_color: ThemeColor, text: string) => borderColor(text) } as unknown as Theme;
}

/** Pi's top border carries the working status between dashes; reuse it as the frame's title. */
function topBorderLabel(line: string): string | undefined {
  const plain = stripTerminalSequences(line);
  // Pi pads the status with spaces inside its own color codes, so trim on the plain text, not the styled one.
  const start = plain.search(/[^─\s]/);
  if (start < 0) return undefined;
  let end = plain.length;
  while (end > start && /[─\s]/.test(plain[end - 1])) end--;
  const from = visibleWidth(plain.slice(0, start));
  const text = sliceByColumn(line, from, visibleWidth(plain.slice(0, end)) - from).trim();
  return text === "" ? undefined : text;
}

/**
 * Wrap the editor's own lines in a rounded box. `bottomIndex` is Pi's bottom border: everything after it is the
 * autocomplete list, which stays outside the box.
 */
export function frameEditor(
  lines: readonly string[],
  width: number,
  borderColor: (text: string) => string,
  bottomIndex: number,
  labels: EditorBorderLabels,
): string[] {
  if (width < 4) return [...lines];
  const theme = borderTheme(borderColor);
  const framed = [frameTop(width, theme, "border", { left: labels.top })];
  for (let i = 1; i < lines.length; i++) {
    if (i === bottomIndex) framed.push(frameBottom(width, theme, "border", labels));
    else if (i > bottomIndex) framed.push(truncateToWidth(lines[i], width, ""));
    else framed.push(frameRow(lines[i], width, theme, "border", 0));
  }
  return framed;
}

export class TuneEditor extends CustomEditor {
  private model: string;
  private thinking: string;
  private readonly themeOf: () => Theme;
  private readonly now: () => number;
  private readonly onPreview?: (id: number) => void;
  private readonly onBeforeSubmit?: () => void;
  private readonly onAcceptSuggestion?: () => void;
  private stash?: Stash;
  private stashConfirmUntil?: number;
  private confirmTimer?: ReturnType<typeof setTimeout>;
  private framed = false;
  private ghost?: string;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options: TuneEditorOptions) {
    // Same options Pi gives its default editor, so the working status stays in the top border.
    super(tui, theme, keybindings, {
      paddingX: options.paddingX,
      autocompleteMaxVisible: options.autocompleteMaxVisible,
      embedWorkingStatus: true,
    });
    this.model = options.model;
    this.thinking = options.thinking;
    this.themeOf = options.theme;
    this.now = options.now ?? (() => Date.now());
    this.onPreview = options.onPreview;
    this.onBeforeSubmit = options.onBeforeSubmit;
    this.onAcceptSuggestion = options.onAcceptSuggestion;
  }

  setStatus(model: string, thinking: string): void {
    this.model = model;
    this.thinking = thinking;
  }

  /** Ghost suggestion shown on the empty editor's first content row; Tab fills it. */
  setSuggestion(text: string | undefined): void {
    this.ghost = text;
    this.tui.requestRender();
  }

  getSuggestion(): string | undefined {
    return this.ghost;
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
      this.handleStash();
      return;
    }
    this.clearStashConfirm();
    if (data === "\r" || data === "\n" || matchesKey(data, "enter")) {
      const marker = this.markerAtCursor();
      if (marker) {
        this.onPreview?.(marker.id);
        return;
      }
    }
    // `\n` (ctrl+j) matches both bindings; the editor inserts a new line for it.
    const keys = getKeybindings();
    if (
      keys.matches(data, "tui.input.submit") &&
      !keys.matches(data, "tui.input.newLine") &&
      this.getText().trim() !== "" &&
      !this.isShowingAutocomplete()
    ) {
      this.onBeforeSubmit?.();
    }
    if (data === "\t" && this.ghostVisible() && !this.isShowingAutocomplete()) {
      const text = this.ghost;
      this.ghost = undefined;
      if (text !== undefined) this.setText(text);
      this.onAcceptSuggestion?.();
      this.tui.requestRender();
      return;
    }
    super.handleInput(data);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    // The inner editor renders two columns narrower, inside the left border.
    const result = super.handleMouse(this.framed ? { ...event, x: event.x - 1 } : event);
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

  render(width: number): string[] {
    this.framed = width >= 4;
    const lines = super.render(this.framed ? width - 2 : width);
    const bottom = lines.findIndex((line) => line.startsWith(BOTTOM_MARK));
    if (!this.framed || bottom < 0) return lines;
    const plain = lines.map((line, index) => (index === bottom ? line.slice(BOTTOM_MARK.length) : line));
    if (this.ghostVisible() && bottom === 2) {
      // The empty editor has exactly one content row between the borders; overlay the ghost text there.
      plain[1] = withGhostSuggestion(plain[1], this.ghost ?? "", (text) => this.themeOf().fg("dim", text), width - 2);
    }
    // The working status takes the border color, like the model label on the bottom border.
    const status = topBorderLabel(plain[0] ?? "");
    return frameEditor(plain, width, this.borderColor, bottom, {
      top: status === undefined ? undefined : this.borderColor(stripTerminalSequences(status)),
      left: this.leftLabel(),
      right: this.borderColor(`${this.model} · ${this.thinking}`),
    });
  }

  protected renderBottomBorder(width: number, hiddenLineCount: number): string {
    return BOTTOM_MARK + super.renderBottomBorder(width, hiddenLineCount);
  }

  private ghostVisible(): boolean {
    return this.ghost !== undefined && this.ghost !== "" && this.getText().length === 0;
  }

  private leftLabel(): string | undefined {
    if (this.stashConfirming()) return this.themeOf().fg("warning", "ctrl+s again to replace stash");
    if (this.stash) return this.borderColor("stashed");
    return undefined;
  }

  private stashConfirming(): boolean {
    if (this.stashConfirmUntil === undefined) return false;
    if (this.now() < this.stashConfirmUntil) return true;
    this.clearStashConfirm();
    return false;
  }

  private clearStashConfirm(): void {
    if (this.confirmTimer !== undefined) clearTimeout(this.confirmTimer);
    this.confirmTimer = undefined;
    this.stashConfirmUntil = undefined;
  }

  /** ctrl+s: stash, restore, or — with a stash already held — ask once before replacing it. */
  private handleStash(): void {
    const confirming = this.stashConfirming();
    this.clearStashConfirm();
    if (this.getText().length === 0) {
      this.restoreStash();
      return;
    }
    if (this.stash && !confirming) {
      this.stashConfirmUntil = this.now() + STASH_CONFIRM_MS;
      this.confirmTimer = setTimeout(() => {
        this.clearStashConfirm();
        this.tui.requestRender();
      }, STASH_CONFIRM_MS);
      this.tui.requestRender();
      return;
    }
    const { line, col } = this.getCursor();
    this.stash = { text: this.getExpandedText(), line, col };
    this.setText("");
    this.tui.requestRender();
  }

  private restoreStash(): void {
    const stash = this.stash;
    if (!stash) return;
    this.stash = undefined;
    this.setText(stash.text);
    this.restoreCursor(stash.line, stash.col);
    this.tui.requestRender();
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

  private restoreCursor(line: number, col: number): void {
    const lastLine = this.getText().split("\n").length - 1;
    for (let i = 0; i < lastLine; i++) super.handleInput("\x1b[A");
    super.handleInput("\x01");
    for (let i = 0; i < line; i++) super.handleInput("\x1b[B");
    for (let i = 0; i < col; i++) super.handleInput("\x1b[C");
  }
}
