import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { collectPrompts, type Prompt, type ScrollableTui } from "../internals/transcript.ts";

export interface StickyPrompt {
  index: number;
  text: string;
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

export function stickyLine(prompt: StickyPrompt, width: number, theme: Theme): string {
  const label = `› ${prompt.text.replace(/\s+/g, " ").trim()} · prompt ${prompt.index + 1}`;
  return theme.bg("userMessageBg", truncateToWidth(label, width, "…", true));
}

/** One row at the top of the transcript; renders nothing while the owning prompt is on screen. */
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
    return [stickyLine(sticky, Math.max(0, width - 1), this.getTheme())];
  }

  invalidate(): void {}
}
