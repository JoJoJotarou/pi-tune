import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatDuration } from "../shared/format.ts";

export type ToolStatus = "running" | "success" | "error";

/** running until the call has a final result; then error when context.isError, else success. */
export function toolStatus(context: { executionStarted: boolean; isPartial: boolean; isError: boolean }): ToolStatus {
  if (!context.executionStarted || context.isPartial) return "running";
  return context.isError ? "error" : "success";
}

export interface HeaderParts {
  status: ToolStatus;
  name: string;
  summary: string;
  meta?: string;
  durationMs?: number;
}

const ICONS: Record<ToolStatus, { icon: string; color: "warning" | "success" | "error" }> = {
  running: { icon: "●", color: "warning" },
  success: { icon: "✓", color: "success" },
  error: { icon: "✗", color: "error" },
};

/** Exactly one line, never wider than `width`. */
export function renderHeader(parts: HeaderParts, width: number, theme: Theme): string {
  if (width <= 0) return "";

  const { icon, color } = ICONS[parts.status];
  const prefix = `${theme.fg(color, icon)} ${theme.bold(parts.name)}`;
  const prefixWidth = visibleWidth(prefix);
  const duration = parts.durationMs === undefined ? undefined : formatDuration(parts.durationMs);

  const compose = (summary: string, right: string): string | undefined => {
    const left = summary ? `${prefix} ${theme.fg("accent", summary)}` : prefix;
    const leftWidth = visibleWidth(left);
    const rightText = theme.fg("dim", right);
    const gap = width - leftWidth - visibleWidth(rightText);
    return gap >= 2 ? `${left}${" ".repeat(gap)}${rightText}` : undefined;
  };

  const composeWithoutRight = (summary: string): string | undefined => {
    const left = summary ? `${prefix} ${theme.fg("accent", summary)}` : prefix;
    const leftWidth = visibleWidth(left);
    return leftWidth <= width ? `${left}${" ".repeat(width - leftWidth)}` : undefined;
  };

  const cutSummary = (summary: string, available: number): string | undefined => {
    if (!summary || available < 8) return undefined;
    return truncateToWidth(summary, available, "…");
  };

  const tryRight = (right: string): string | undefined => {
    const full = compose(parts.summary, right);
    if (full) return full;
    const available = width - prefixWidth - 3 - visibleWidth(right);
    const cut = cutSummary(parts.summary, available);
    return cut === undefined ? undefined : compose(cut, right);
  };

  const combined = [parts.meta, duration].filter((part): part is string => Boolean(part)).join(" · ");
  if (combined) {
    const full = tryRight(combined);
    if (full) return full;
    if (parts.meta && duration) {
      const withoutMeta = tryRight(duration);
      if (withoutMeta) return withoutMeta;
    }
  }

  const withoutRight = composeWithoutRight(parts.summary);
  if (withoutRight) return withoutRight;

  const cut = cutSummary(parts.summary, width - prefixWidth - 1);
  if (cut) {
    const line = composeWithoutRight(cut);
    if (line) return line;
  }

  const left = parts.summary ? `${prefix} ${theme.fg("accent", parts.summary)}` : prefix;
  return truncateToWidth(left, width, "…");
}
