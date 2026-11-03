import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type OverlayOptions, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface FrameLabels {
  /** Pre-styled text at the left of the border line. */
  left?: string;
  /** Pre-styled text at the right of the border line. */
  right?: string;
}

const MIN_LABEL = 4;

/**
 * One border line exactly `width` columns wide: `╭─ left ──── right ─╮`.
 * Labels keep one space on each side; the right label is cut first, then the left, so the corners never break.
 */
function borderLine(
  width: number,
  theme: Theme,
  color: ThemeColor,
  corners: [string, string],
  labels: FrameLabels,
): string {
  if (width < 2) return theme.fg(color, "─".repeat(Math.max(0, width)));
  const inner = width - 2;
  // A label costs its width plus a dash and two spaces ("─ left " / " right ─"); keep one dash between labels.
  let left = labels.left ?? "";
  let right = labels.right ?? "";
  const cost = (text: string) => (text ? visibleWidth(text) + 3 : 0);
  const fits = () => cost(left) + cost(right) + 1 <= inner;

  if (!fits()) {
    const room = inner - cost(left) - 4;
    right = room >= MIN_LABEL ? truncateToWidth(right, room, "…") : "";
  }
  if (!fits()) {
    const room = inner - cost(right) - 4;
    left = room >= MIN_LABEL ? truncateToWidth(left, room, "…") : "";
  }

  const dash = (count: number) => theme.fg(color, "─".repeat(Math.max(0, count)));
  const head = left ? `${dash(1)} ${left} ` : "";
  const tail = right ? ` ${right} ${dash(1)}` : "";
  const fill = inner - visibleWidth(head) - visibleWidth(tail);
  return `${theme.fg(color, corners[0])}${head}${dash(fill)}${tail}${theme.fg(color, corners[1])}`;
}

export function frameTop(width: number, theme: Theme, color: ThemeColor, labels: FrameLabels = {}): string {
  return borderLine(width, theme, color, ["╭", "╮"], labels);
}

export function frameBottom(width: number, theme: Theme, color: ThemeColor, labels: FrameLabels = {}): string {
  return borderLine(width, theme, color, ["╰", "╯"], labels);
}

/** `│ content │`, padded to exactly `width` so the frame covers whatever is behind it. */
export function frameRow(content: string, width: number, theme: Theme, color: ThemeColor, paddingX = 1): string {
  if (width < 2) return theme.fg(color, "│".repeat(Math.max(0, width)));
  const inner = width - 2;
  const pad = Math.min(paddingX, Math.floor(inner / 2));
  const body = truncateToWidth(content, inner - 2 * pad, "", true);
  return `${theme.fg(color, "│")}${" ".repeat(pad)}${body}${" ".repeat(pad)}${theme.fg(color, "│")}`;
}

export interface FrameOptions {
  color: ThemeColor;
  title?: string;
  meta?: string;
  hints?: string;
  paddingX?: number;
}

/** Wrap content lines in a rounded frame: title and meta on the top border, hints on the bottom one. */
export function frame(lines: readonly string[], width: number, theme: Theme, options: FrameOptions): string[] {
  return [
    frameTop(width, theme, options.color, { left: options.title, right: options.meta }),
    ...lines.map((line) => frameRow(line, width, theme, options.color, options.paddingX)),
    frameBottom(width, theme, options.color, { left: options.hints }),
  ];
}

/** Overlay placement shared by every modal: centered, full width minus a 2-column margin on each side. */
export const MODAL_OVERLAY: OverlayOptions = { anchor: "center", width: "100%", margin: { left: 2, right: 2 } };

/** Body rows for a modal: at least 60% of the terminal so short content still reads as a window, at most rows − 6. */
export function modalBodyRows(contentRows: number, terminalRows: number): number {
  const max = Math.max(1, terminalRows - 6);
  const min = Math.min(max, Math.ceil(terminalRows * 0.6) - 2);
  return Math.max(min, Math.min(contentRows, max));
}

/** Join key hints with Pi's dim separator. Build each hint with Pi's `keyHint` / `rawKeyHint`. */
export function joinHints(theme: Theme, hints: readonly string[]): string {
  return hints.join(theme.fg("dim", " · "));
}
