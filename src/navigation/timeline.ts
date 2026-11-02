import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type TuiMouseEvent, truncateToWidth } from "@earendil-works/pi-tui";
import { collectPrompts, jumpTo, type ScrollableTui, transcriptViewportHeight } from "../internals/transcript.ts";
import { nearestPrompt, type RailCell, railCells } from "./rail.ts";

export function promptLabel(index: number, text: string): string {
  return `${index + 1}  ${truncateToWidth(text.replace(/\s+/g, " "), 60)}`;
}

function renderCell(cell: RailCell, theme: Theme): string {
  switch (cell) {
    case "tick":
      return theme.fg("muted", "─");
    case "current":
      return theme.bold(theme.fg("accent", "━"));
    case "thumb":
      return theme.fg("dim", "│");
    case "empty":
      return " ";
  }
}

export class TimelineRail implements Component {
  private readonly tui: ScrollableTui;
  private readonly theme: Theme;
  private readonly onError: (error: Error) => void;
  private disabled = false;

  constructor(tui: ScrollableTui, theme: Theme, onError: (error: Error) => void) {
    this.tui = tui;
    this.theme = theme;
    this.onError = onError;
  }

  private layout() {
    const width = this.tui.terminal.columns;
    return {
      height: transcriptViewportHeight(this.tui, width),
      transcript: collectPrompts(this.tui, width),
    };
  }

  private disable(error: Error): void {
    if (this.disabled) return;
    this.disabled = true;
    this.onError(error);
  }

  render(): string[] {
    if (this.disabled) return [];
    const { height, transcript } = this.layout();
    if (transcript instanceof Error) {
      this.disable(transcript);
      return [];
    }
    const cells = railCells({
      prompts: transcript.prompts,
      total: transcript.total,
      viewportTop: this.tui.viewportTop,
      height,
    });
    return cells.map((cell) => renderCell(cell, this.theme));
  }

  handleMouse(event: TuiMouseEvent): { handled: true } {
    if (event.type !== "click" || event.button !== "left") return { handled: true };
    if (this.disabled) return { handled: true };
    const { height, transcript } = this.layout();
    if (transcript instanceof Error) {
      this.disable(transcript);
      return { handled: true };
    }
    const prompt = nearestPrompt(transcript.prompts, transcript.total, height, event.y);
    if (prompt) jumpTo(this.tui, prompt.row);
    return { handled: true };
  }

  invalidate(): void {}
}
