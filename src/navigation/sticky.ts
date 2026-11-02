import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { collectPrompts, type Prompt, type ScrollableTui } from "../internals/transcript.ts";
import { MIN_PROMPTS, MIN_TERMINAL_WIDTH, RAIL_WIDTH } from "./timeline.ts";

export interface StickyPrompt {
  index: number;
  text: string;
}

const MAX_TEXT_ROWS = 3;
/** Pi's scrollbar column, left uncovered while the timeline rail is hidden. */
const SCROLLBAR_WIDTH = 1;

interface StickyFrame {
  prompt: StickyPrompt;
  /** Right-hand columns left free for the rail or Pi's scrollbar. */
  reserved: number;
}

/**
 * The prompt that owns the first visible row, when its own row has scrolled above the viewport. A prompt sitting
 * exactly on the first visible row is already on screen, so it needs no sticky line.
 */
export function stickyPrompt(prompts: readonly Prompt[], viewportTop: number): StickyPrompt | undefined {
  let found: { index: number; prompt: Prompt } | undefined;
  for (let index = 0; index < prompts.length; index++) {
    const prompt = prompts[index];
    if (prompt.row > viewportTop) break;
    found = { index, prompt };
  }
  if (!found || found.prompt.row === viewportTop) return undefined;
  return { index: found.index, text: found.prompt.text };
}

/** One prompt row, painted like Pi's own user message: `userMessageBg` across the full width, 1 column padding. */
function promptRow(text: string, width: number, theme: Theme): string {
  const inner = width - 2;
  return theme.bg("userMessageBg", ` ${theme.fg("userMessageText", truncateToWidth(text, inner, "", true))} `);
}

/**
 * Pi's user message look: a painted blank row, up to 3 rows of the prompt wrapped to the width, a painted blank
 * row. When the prompt does not fit, the last row ends with ` …`.
 */
export function stickyRows(prompt: StickyPrompt, width: number, theme: Theme): string[] {
  if (width < 4) return [];
  const inner = width - 2;
  const wrapped = wrapTextWithAnsi(prompt.text.trim(), inner);
  const rows = wrapped.slice(0, MAX_TEXT_ROWS);
  if (wrapped.length > MAX_TEXT_ROWS) {
    const last = MAX_TEXT_ROWS - 1;
    rows[last] = `${truncateToWidth(rows[last], inner - 2, "", false).trimEnd()} …`;
  }
  const blank = theme.bg("userMessageBg", " ".repeat(width));
  return [blank, ...rows.map((row) => promptRow(row, width, theme)), blank];
}

/** The sticky prompt at the top of the transcript; renders nothing while the owning prompt is on screen. */
export class StickyBar implements Component {
  private readonly tui: ScrollableTui;
  private readonly getTheme: () => Theme;
  private readonly onError: (error: Error) => void;
  private disabled = false;
  /** Frame computed by `visible()` and reused by the next render in the same frame. */
  private pending: StickyFrame | undefined;

  constructor(tui: ScrollableTui, getTheme: () => Theme, onError: (error: Error) => void) {
    this.tui = tui;
    this.getTheme = getTheme;
    this.onError = onError;
  }

  private current(): StickyFrame | undefined {
    const columns = this.tui.terminal.columns;
    const transcript = collectPrompts(this.tui, columns);
    if (transcript instanceof Error) {
      if (!this.disabled) {
        this.disabled = true;
        this.onError(transcript);
      }
      return undefined;
    }
    const prompt = stickyPrompt(transcript.prompts, this.tui.viewportTop);
    if (!prompt) return undefined;
    // The timeline rail's own eligibility rule.
    const railShown = columns >= MIN_TERMINAL_WIDTH && transcript.prompts.length >= MIN_PROMPTS;
    return { prompt, reserved: railShown ? RAIL_WIDTH : SCROLLBAR_WIDTH };
  }

  /** Overlay gate: Pi's own scrollbar and selection work only while no overlay is visible. */
  visible(): boolean {
    if (this.disabled) return false;
    this.pending = this.current();
    return this.pending !== undefined;
  }

  render(width: number): string[] {
    if (this.disabled) return [];
    const frame = this.pending ?? this.current();
    this.pending = undefined;
    if (!frame) return [];
    return stickyRows(frame.prompt, Math.max(0, width - frame.reserved), this.getTheme());
  }

  invalidate(): void {}
}
