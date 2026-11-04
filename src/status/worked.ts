import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { workedFor } from "./activity.ts";

/** Session entry a finished run leaves behind: `Worked for 2.9s`, outside the model's context. */
export const WORKED_TYPE = "pi-tune:worked";

export interface WorkedData {
  ms: number;
}

/** One dim transcript line, indented like the transcript text around it and cut to the width it gets. */
class WorkedLine implements Component {
  private readonly text: string;
  private readonly theme: Theme;

  constructor(text: string, theme: Theme) {
    this.text = text;
    this.theme = theme;
  }

  render(width: number): string[] {
    return [truncateToWidth(` ${this.theme.fg("dim", this.text)}`, width, "…")];
  }

  invalidate(): void {}
}

/** The transcript component for a `WORKED_TYPE` entry, or `undefined` when its data is unusable. */
export function workedEntry(data: WorkedData | undefined, theme: Theme): Component | undefined {
  if (data === undefined || !Number.isFinite(data.ms)) return undefined;
  return new WorkedLine(workedFor(data.ms), theme);
}
