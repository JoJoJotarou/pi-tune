import type { Theme } from "@earendil-works/pi-coding-agent";
import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

/** Body lines shown before folding. */
export const PREVIEW_LINES = 3;

/** `… 27 more lines · click to expand`: a click expands this block, ctrl+o is never named here. */
export function truncationLine(hidden: number, theme: Theme): string {
  return theme.fg("dim", `… ${hidden} more line${hidden === 1 ? "" : "s"} · click to expand`);
}

export interface DiffCounts {
  added: number;
  removed: number;
}

/** Added and removed lines of a diff string, which Pi renders as ` 1 ctx`, `-2 old`, `+2 new`. */
export function diffCounts(diffText: string): DiffCounts {
  let added = 0;
  let removed = 0;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { added, removed };
}

/** The header meta of a diff: `+16 −12`, or `overwrite · +16 −12`. */
export function diffMeta(diffText: string, prefix?: string): string {
  const { added, removed } = diffCounts(diffText);
  return [prefix, `+${added} −${removed}`].filter((part) => Boolean(part)).join(" · ");
}

const PROMPT = "$ ";

/** The full shell command wrapped to `width`, drawn as Pi's native title (`$ ` plus the command). */
export function bashCommandLines(command: string, width: number, theme: Theme): string[] {
  const lines: string[] = [];
  for (const source of command.replace(/\n$/, "").split("\n")) {
    const wrapped = wrapTextWithAnsi(source, Math.max(1, width - PROMPT.length));
    lines.push(...(wrapped.length === 0 ? [""] : wrapped));
  }
  return lines.map((line, index) =>
    theme.fg("toolTitle", `${index === 0 ? PROMPT : " ".repeat(PROMPT.length)}${line}`),
  );
}

/** Pi's render result lines without the blank lines it pads around its output and its trailing spaces. */
export function trimOutput(lines: string[]): string[] {
  const trimmed = lines.map((line) => line.replace(/ +$/, ""));
  while (trimmed.length > 0 && trimmed[0].trim() === "") trimmed.shift();
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].trim() === "") trimmed.pop();
  return trimmed;
}
