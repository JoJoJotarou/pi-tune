import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface HeaderCounts {
  /** Commands whose source is `skill`, from `pi.getCommands()`. */
  skills: number;
  mcp: { connected: number; configured: number };
}

export interface HeaderParts extends HeaderCounts {
  version: string;
  /** Cwd basename, never the full path. */
  cwd: string;
}

/** Right side of the header, `""` when there is nothing to count. */
export function headerRight(counts: HeaderCounts, theme: Theme): string {
  const parts: string[] = [];
  if (counts.skills > 0) parts.push(`${counts.skills} ${counts.skills === 1 ? "skill" : "skills"}`);
  if (counts.mcp.configured > 0 || counts.mcp.connected > 0) {
    parts.push(`MCP ${counts.mcp.connected}/${counts.mcp.configured}`);
  }
  return parts.length === 0 ? "" : theme.fg("dim", parts.join(" · "));
}

function elideLeft(text: string, width: number): string {
  const textWidth = visibleWidth(text);
  if (textWidth <= width) return text;
  if (width <= 1) return truncateToWidth(text, Math.max(0, width), "…", true);
  return `…${sliceByColumn(text, textWidth - (width - 1), width - 1)}`;
}

export function headerLine(parts: HeaderParts, width: number, theme: Theme): string {
  if (width <= 0) return "";
  const brand = `${theme.bold(theme.fg("accent", "π"))} ${theme.fg("text", `pi ${parts.version}`)}`;
  const brandWidth = visibleWidth(brand);
  const right = headerRight(parts, theme);
  const rightWidth = visibleWidth(right);

  const left = (budget: number): string => {
    const cwdWidth = budget - brandWidth - " · ".length;
    if (cwdWidth <= 0) return brand;
    return brand + theme.fg("muted", ` · ${elideLeft(parts.cwd, cwdWidth)}`);
  };

  if (rightWidth > 0 && brandWidth + rightWidth + 1 <= width) {
    const leftPart = left(width - rightWidth - 1);
    const gap = width - visibleWidth(leftPart) - rightWidth;
    return leftPart + " ".repeat(gap) + right;
  }
  return truncateToWidth(left(width), width);
}
