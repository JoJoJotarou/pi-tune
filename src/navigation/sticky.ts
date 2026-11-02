import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { collectPrompts, type Prompt, type ScrollableTui } from "../internals/transcript.ts";

export interface StickyPrompt {
  index: number;
  text: string;
}

const MAX_TEXT_ROWS = 3;

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

  constructor(tui: ScrollableTui, getTheme: () => Theme, onError: (error: Error) => void) {
    this.tui = tui;
    this.getTheme = getTheme;
    this.onError = onError;
  }

  render(width: number): string[] {
    if (this.disabled) return [];
    const transcript = collectPrompts(this.tui, this.tui.terminal.columns);
    if (transcript instanceof Error) {
      this.disabled = true;
      this.onError(transcript);
      return [];
    }
    const sticky = stickyPrompt(transcript.prompts, this.tui.viewportTop);
    if (!sticky) return [];
    // The last column stays free for the timeline rail.
    return stickyRows(sticky, Math.max(0, width - 1), this.getTheme());
  }

  invalidate(): void {}
}
