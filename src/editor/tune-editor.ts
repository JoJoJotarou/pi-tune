import {
  CustomEditor,
  type KeybindingsManager,
  keyText,
  type Theme,
  type ThemeColor,
} from "@earendil-works/pi-coding-agent";
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
import { BTW_BORDER } from "../shared/btw.ts";
import { frameBottom, frameRow, frameTop } from "../shared/frame.ts";
import { isLargePaste, markerAt, type PasteMarker, removeMarker, replaceMarker } from "./paste.ts";
import { withGhostSuggestion } from "./suggestion.ts";

const STASH_CONFIRM_MS = 3000;
/** Pi exits when `app.clear` arrives twice within 500 ms of each other; the label lives exactly that long. */
const CTRL_C_WINDOW_MS = 500;
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
  /** End of Pi's double `app.clear` window, while the border names that second press. */
  private ctrlCUntil?: number;
  private ctrlCTimer?: ReturnType<typeof setTimeout>;
  private framed = false;
  private ghost?: string;
  /** Enter sends to a btw side thread: the frame takes the drawer's color and the suggestion stays hidden. */
  private btw = false;

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
    this.keybindingsOf = keybindings;
    this.now = options.now ?? (() => Date.now());
    this.onPreview = options.onPreview;
    this.onBeforeSubmit = options.onBeforeSubmit;
    this.onAcceptSuggestion = options.onAcceptSuggestion;
    this.onDismissSuggestion = options.onDismissSuggestion;
    this.onStashChange = options.onStashChange;
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
    const rest = this.ghostRest();
    if (rest !== undefined && bottom === 2) {
      // A one-line draft has exactly one content row between the borders; the rest goes after its cursor.
      plain[1] = withGhostSuggestion(plain[1], rest, (text) => this.themeOf().fg("dim", text), width - 2);
    }
    // The working status takes the border color, like the model label on the bottom border.
    const border = (text: string) => this.frameColor(text);
    const status = topBorderLabel(plain[0] ?? "");
    const top = [...(this.btw ? ["btw"] : []), ...(status === undefined ? [] : [stripTerminalSequences(status)])];
    return frameEditor(plain, width, border, bottom, {
      top: top.length === 0 ? undefined : border(top.join(" · ")),
      left: this.leftLabel(),
      right: border(`${this.model} · ${this.thinking}`),
    });
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

  private leftLabel(): string | undefined {
    if (this.stashConfirming()) return this.themeOf().fg("warning", "ctrl+s again to replace stash");
    if (this.ctrlCConfirming()) return this.themeOf().fg("warning", `${keyText("app.clear")} again to exit`);
    if (this.stash) return this.frameColor("stashed");
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
