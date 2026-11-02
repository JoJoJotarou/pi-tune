import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface HeaderParts {
  version: string;
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
  const right = theme.fg("dim", "/hotkeys");
  const prefix = `π pi ${parts.version} · `;
  const available = width - visibleWidth(prefix) - visibleWidth(right) - 2;
  if (available < 2) {
    return truncateToWidth(`${theme.fg("text", `π pi ${parts.version}`)} ${right}`, width);
  }

  const cwd = elideLeft(parts.cwd, available);
  const left = theme.fg("text", prefix + cwd);
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
  return left + " ".repeat(gap) + right;
}
