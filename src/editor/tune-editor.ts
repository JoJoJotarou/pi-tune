import { CustomEditor, type KeybindingsManager, keyText, type Theme } from "@earendil-works/pi-coding-agent";
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
import { blockBackground } from "../shared/bg.ts";
import { BTW_BORDER } from "../shared/btw.ts";
import { BLOCK_PADDING, blockContentWidth, blockEdgeRow, blockRows, statusLine } from "./block.ts";
import { isLargePaste, markerAt, type PasteMarker, removeMarker, replaceMarker } from "./paste.ts";
import { withGhostSuggestion } from "./suggestion.ts";

const STASH_CONFIRM_MS = 3000;
/** Pi exits when `app.clear` arrives twice within 500 ms of each other; the label lives exactly that long. */
const CTRL_C_WINDOW_MS = 500;
/** Zero-width APC: Pi pads every content line, so the bottom border needs its own tag to stay findable. */
const BOTTOM_MARK = "\u001b_pi:tune-bottom\u0007";
/**
 * The block's background: Pi has no neutral input token, and `toolPendingBg` is its one gray block fill. A btw side
 * thread tints the block with `customMessageBg`, the color pi-tune's drawer already uses for that thread.
 */
const BLOCK_BG = "toolPendingBg";
const BTW_BG = "customMessageBg";

export interface TuneEditorOptions {
  /** Full theme for tokens the editor factory does not receive (`warning`). */
  theme: () => Theme;
  paddingX?: number;
  autocompleteMaxVisible?: number;
  onPreview?: (id: number) => void;
  /** Injected clock so tests can run the stash confirmation window without waiting. */
  now?: () => number;
  /** Runs before every submit, including commands that start no agent run. */
  onBeforeSubmit?: () => void;
  /** Runs when tab or right arrow fills the editor with the suggestion. */
  onAcceptSuggestion?: () => void;
  /** Runs when esc on the empty editor dismisses the suggestion. */
  onDismissSuggestion?: () => void;
  /** Runs when a stash is taken (`true`) or restored (`false`), so the footer can name the next `ctrl+s`. */
  onStashChange?: (held: boolean) => void;
}

interface Stash {
  text: string;
  line: number;
  col: number;
}

/** Pi's top border carries the working status between dashes; lift it out as the block's status line. */
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

export class TuneEditor extends CustomEditor {
  private readonly themeOf: () => Theme;
  /** Pi resolves app actions through this manager; the parent keeps its copy private. */
  private readonly keybindingsOf: KeybindingsManager;
  private readonly now: () => number;
  private readonly onPreview?: (id: number) => void;
  private readonly onBeforeSubmit?: () => void;
  private readonly onAcceptSuggestion?: () => void;
  private readonly onDismissSuggestion?: () => void;
  private readonly onStashChange?: (held: boolean) => void;
  private stash?: Stash;
  private stashConfirmUntil?: number;
  private confirmTimer?: ReturnType<typeof setTimeout>;
  /** End of Pi's double `app.clear` window, while the status line names that second press. */
  private ctrlCUntil?: number;
  private ctrlCTimer?: ReturnType<typeof setTimeout>;
  /** Columns before the draft on the last rendered frame; mouse coordinates are shifted by it. */
  private blockOffset = 0;
  /** Rows between our row 0 and Pi's own layout: Pi counts its top border, the block does not draw it. */
  private rowShift = 0;
  private ghost?: string;
  /** Enter sends to a btw side thread: the block takes the drawer's color and the suggestion stays hidden. */
  private btw = false;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options: TuneEditorOptions) {
    // Same options Pi gives its default editor, so the working status stays in the top border.
    super(tui, theme, keybindings, {
      paddingX: options.paddingX,
      autocompleteMaxVisible: options.autocompleteMaxVisible,
      embedWorkingStatus: true,
    });
    this.themeOf = options.theme;
    this.keybindingsOf = keybindings;
    this.now = options.now ?? (() => Date.now());
    this.onPreview = options.onPreview;
    this.onBeforeSubmit = options.onBeforeSubmit;
    this.onAcceptSuggestion = options.onAcceptSuggestion;
    this.onDismissSuggestion = options.onDismissSuggestion;
    this.onStashChange = options.onStashChange;
  }

  /** Ghost suggestion shown on the empty editor's first content row; Tab fills it. */
  setSuggestion(text: string | undefined): void {
    this.ghost = text;
    this.tui.requestRender();
  }

  getSuggestion(): string | undefined {
    return this.ghost;
  }

  setBtwMode(on: boolean): void {
    this.btw = on;
    this.tui.requestRender();
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
    this.noteCtrlC(data);
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
      !this.btw &&
      keys.matches(data, "tui.input.submit") &&
      !keys.matches(data, "tui.input.newLine") &&
      this.getText().trim() !== "" &&
      !this.isShowingAutocomplete()
    ) {
      this.onBeforeSubmit?.();
    }
    if ((data === "\t" || matchesKey(data, "right")) && this.ghostRest() !== undefined) {
      const text = this.ghost;
      this.ghost = undefined;
      if (text !== undefined) this.setText(text);
      this.onAcceptSuggestion?.();
      this.tui.requestRender();
      return;
    }
    if (matchesKey(data, "escape") && this.ghostRest() !== undefined && this.getText() === "") {
      // Pi still gets the key, so a double esc keeps opening the session tree.
      this.ghost = undefined;
      this.onDismissSuggestion?.();
      this.tui.requestRender();
    }
    super.handleInput(data);
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    // The draft renders inside the block, after the margin and the gutter, and the block drops Pi's top border,
    // so a click is shifted by both the gutter and the rows the block added or removed above the draft.
    const result =
      this.blockOffset > 0
        ? super.handleMouse({ ...event, x: event.x - this.blockOffset, y: event.y + this.rowShift })
        : super.handleMouse(event);
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
    const inner = blockContentWidth(width);
    this.blockOffset = width - inner;
    if (inner < 1) {
      // Too narrow for a gutter: Pi's own editor keeps the draft visible.
      this.blockOffset = 0;
      return super.render(width);
    }
    const lines = super.render(inner);
    const bottom = lines.findIndex((line) => line.startsWith(BOTTOM_MARK));
    if (bottom < 0) return lines.map((line) => truncateToWidth(line, width, ""));
    const plain = lines.map((line, index) => (index === bottom ? line.slice(BOTTOM_MARK.length) : line));
    const content = plain.slice(1, bottom);
    const rest = this.ghostRest();
    if (rest !== undefined && content.length === 1) {
      // A one-line draft has exactly one content row; the rest of the suggestion goes after its cursor.
      content[0] = withGhostSuggestion(content[0], rest, (text) => this.themeOf().fg("dim", text), inner);
    }
    // The chevron keeps Pi's own editor border color, which follows the thinking level.
    const paint = blockBackground(this.btw ? BTW_BG : BLOCK_BG, this.themeOf());
    const above = this.statusLabel(plain[0] ?? "");
    // Our first content row sits below Pi's top border and the status line, above the block's top edge.
    this.rowShift = 1 - (above === undefined ? 0 : 1) - BLOCK_PADDING;
    const theme = this.themeOf();
    const fill = theme.colors[this.btw ? BTW_BG : BLOCK_BG];
    // Pi draws the autocomplete list flush left; the block must not push it under the draft.
    const menu = plain.slice(bottom + 1).map((line) => truncateToWidth(line, width, "", true));
    return [
      ...(above === undefined ? [] : [statusLine(above, width)]),
      blockEdgeRow(width, "top", fill, theme),
      ...blockRows(content, width, this.frameColor("❯"), paint),
      blockEdgeRow(width, "bottom", fill, theme),
      ...menu,
    ];
  }

  protected renderBottomBorder(width: number, hiddenLineCount: number): string {
    return BOTTOM_MARK + super.renderBottomBorder(width, hiddenLineCount);
  }

  /** The part of the suggestion still to type: shown while the draft is its start and the cursor ends it. */
  private ghostRest(): string | undefined {
    const ghost = this.ghost;
    if (ghost === undefined || this.btw || this.isShowingAutocomplete()) return undefined;
    const text = this.getText();
    if (text.includes("\n") || text.length >= ghost.length || !ghost.startsWith(text)) return undefined;
    const cursor = this.getCursor();
    if (cursor.line !== 0 || cursor.col !== text.length) return undefined;
    return ghost.slice(text.length);
  }

  private frameColor(text: string): string {
    return this.btw ? this.themeOf().fg(BTW_BORDER, text) : this.borderColor(text);
  }

  /**
   * The line above the block: a pi-tune warning first, then Pi's own status. Pi puts its working status and the
   * hidden-line count in the top border, which the block does not draw. btw mode names nothing here: the drawer
   * above already says so, and the block itself takes the drawer's color.
   */
  private statusLabel(topBorder: string): string | undefined {
    if (this.stashConfirming()) return this.themeOf().fg("warning", "ctrl+s again to replace stash");
    if (this.ctrlCConfirming()) return this.themeOf().fg("warning", `${keyText("app.clear")} again to exit`);
    return topBorderLabel(topBorder);
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

  /** Marks the window in which Pi exits on a second `app.clear`, so the border can say so. */
  private noteCtrlC(data: string): void {
    // The editor consumes `app.clear` while its autocomplete is open; Pi never sees that key.
    if (this.isShowingAutocomplete() || !this.keybindingsOf.matches(data, "app.clear")) return;
    if (this.ctrlCTimer !== undefined) clearTimeout(this.ctrlCTimer);
    this.ctrlCUntil = this.now() + CTRL_C_WINDOW_MS;
    this.ctrlCTimer = setTimeout(() => {
      this.ctrlCUntil = undefined;
      this.ctrlCTimer = undefined;
      this.tui.requestRender();
    }, CTRL_C_WINDOW_MS);
  }

  private ctrlCConfirming(): boolean {
    if (this.ctrlCUntil === undefined) return false;
    if (this.now() < this.ctrlCUntil) return true;
    this.ctrlCUntil = undefined;
    return false;
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
    this.onStashChange?.(true);
    this.tui.requestRender();
  }

  private restoreStash(): void {
    const stash = this.stash;
    if (!stash) return;
    this.stash = undefined;
    this.onStashChange?.(false);
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
