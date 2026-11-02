import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface TokenTotals {
  input: number;
  output: number;
}

export interface FooterParts {
  path: string;
  branch?: string;
  hints?: string;
  tokens?: TokenTotals;
  cachePercent?: number | null;
  cost?: number;
  ctxPercent?: number | null;
  statuses?: readonly string[];
}

type OptionalPart = "cost" | "cache" | "tokens" | "hints" | "branch";

const RIGHT_DROP_ORDER: readonly OptionalPart[] = ["cost", "cache", "tokens"];
const MIN_PATH_WIDTH = 8;

/** Compact token counts for one-line UI: `999`, `1.5k`, `12k`, `1.2M`. */
export function compactNumber(value: number): string {
  if (value < 1000) return `${Math.round(value)}`;
  if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

function elideLeft(text: string, width: number): string {
  const textWidth = visibleWidth(text);
  if (textWidth <= width) return text;
  if (width <= 1) return truncateToWidth(text, Math.max(0, width), "…", true);
  return `…${sliceByColumn(text, textWidth - (width - 1), width - 1)}`;
}

function ctxLabel(percent: number, theme: Theme): string {
  const text = `ctx ${Math.round(percent)}%`;
  if (percent > 90) return theme.fg("error", text);
  if (percent > 70) return theme.fg("warning", text);
  return theme.fg("dim", text);
}

export function footerLine(parts: FooterParts, width: number, theme: Theme): string[] {
  if (width <= 0) return [""];

  const present: Record<OptionalPart, boolean> = {
    cost: (parts.cost ?? 0) > 0,
    cache: parts.cachePercent != null,
    tokens: parts.tokens != null,
    hints: (parts.hints ?? "").length > 0,
    branch: (parts.branch ?? "").length > 0,
  };

  const branchSuffix = parts.branch ? ` (${parts.branch})` : "";
  const rightText = (): string => {
    const items: string[] = [];
    if (present.tokens && parts.tokens) {
      items.push(theme.fg("dim", `↑${compactNumber(parts.tokens.input)} ↓${compactNumber(parts.tokens.output)}`));
    }
    if (present.cache && parts.cachePercent != null) {
      items.push(theme.fg("dim", `cache ${Math.round(parts.cachePercent)}%`));
    }
    if (present.cost && parts.cost) {
      items.push(theme.fg("dim", `$${parts.cost.toFixed(3)}`));
    }
    items.push(ctxLabel(parts.ctxPercent ?? 0, theme));
    return items.join(theme.fg("dim", " · "));
  };
  const leftText = (path: string): string =>
    theme.fg("text", path) + (present.branch && parts.branch ? theme.fg("dim", branchSuffix) : "");

  const requiredWidth = (): number => {
    const hints = present.hints ? (parts.hints ?? "") : "";
    return visibleWidth(leftText(parts.path)) + visibleWidth(rightText()) + 2 + (hints ? visibleWidth(hints) + 2 : 0);
  };

  for (const part of RIGHT_DROP_ORDER) {
    if (requiredWidth() <= width) break;
    present[part] = false;
  }

  const branchWidth = present.branch && parts.branch ? visibleWidth(branchSuffix) : 0;
  if (requiredWidth() > width && present.hints) {
    const hintSpace = width - visibleWidth(rightText()) - branchWidth - 2 - visibleWidth(parts.hints ?? "") - 2;
    if (hintSpace < MIN_PATH_WIDTH) present.hints = false;
  }
  if (requiredWidth() > width && !present.hints) present.branch = false;

  const right = rightText();
  const hints = present.hints ? (parts.hints ?? "") : "";
  const hintWidth = visibleWidth(hints);
  let path = parts.path;
  const branchSpace = present.branch && parts.branch ? visibleWidth(branchSuffix) : 0;
  const available = width - visibleWidth(right) - 2 - (hintWidth > 0 ? hintWidth + 2 : 0) - branchSpace;
  if (visibleWidth(path) > available) path = elideLeft(path, Math.max(1, available));

  const left = leftText(path);
  const leftWidth = visibleWidth(left);
  let line: string;
  if (hintWidth > 0) {
    const gap = Math.max(2, width - leftWidth - hintWidth - visibleWidth(right) - 2);
    line = `${left + " ".repeat(gap) + theme.fg("dim", hints)}  ${right}`;
  } else {
    const gap = Math.max(2, width - leftWidth - visibleWidth(right));
    line = left + " ".repeat(gap) + right;
  }

  const lines = [truncateToWidth(line, width)];
  const statuses = (parts.statuses ?? []).filter((status) => status.length > 0);
  if (statuses.length > 0) lines.push(truncateToWidth(statuses.join(" · "), width));
  return lines;
}
