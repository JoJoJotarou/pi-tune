import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface HeaderParts {
  version: string;
  /** Cwd basename, never the full path. */
  cwd: string;
}

function elideLeft(text: string, width: number): string {
  const textWidth = visibleWidth(text);
  if (textWidth <= width) return text;
  if (width <= 1) return truncateToWidth(text, Math.max(0, width), "…", true);
  return `…${sliceByColumn(text, textWidth - (width - 1), width - 1)}`;
}

export function headerLine(parts: HeaderParts, width: number, theme: Theme): string {
  if (width <= 0) return "";
  const right = theme.fg("dim", "/keys");
  const brand = `${theme.bold(theme.fg("accent", "π"))} ${theme.fg("text", `pi ${parts.version}`)}`;
  const available = width - visibleWidth(brand) - visibleWidth(right) - 2;
  const cwdWidth = available - visibleWidth(" · ");
  const suffix = cwdWidth > 0 ? theme.fg("muted", ` · ${elideLeft(parts.cwd, cwdWidth)}`) : "";
  const left = brand + suffix;

  if (visibleWidth(left) + visibleWidth(right) + 1 > width) {
    return truncateToWidth(`${brand} ${right}`, width);
  }
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  return left + " ".repeat(gap) + right;
}
