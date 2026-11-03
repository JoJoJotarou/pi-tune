import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { formatDuration } from "../shared/format.ts";

export type ToolStatus = "running" | "success" | "error";

export type ToolBgToken = "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";

/** The status background of a tool block: same rule as `toolStatus()`. */
export function toolBgToken(status: ToolStatus): ToolBgToken {
  if (status === "running") return "toolPendingBg";
  return status === "error" ? "toolErrorBg" : "toolSuccessBg";
}

const RESET_ALL = "\u001b[0m";
const BG_OFF = "\u001b[49m";

/**
 * Paints a whole block line with the status background, for `Box`. It re-applies the background after
 * any full reset an inner component emitted, so styled text never leaves a hole in the box.
 */
export function statusBackground(status: ToolStatus, theme: Theme): (text: string) => string {
  const open = theme.bg(toolBgToken(status), "").replace(BG_OFF, "");
  return (text) => `${open}${text.split(RESET_ALL).join(`${RESET_ALL}${open}`)}${BG_OFF}`;
}

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
  /** Theme color of the name; the name is bold either way. Pi's own labels keep their own token. */
  nameColor?: ThemeColor;
  /** Theme color of the summary, `accent` unless a native label brings its own. */
  summaryColor?: ThemeColor;
  /** An expanded block wraps the summary over as many lines as it needs instead of cutting it. */
  expanded?: boolean;
}

const ICONS: Record<ToolStatus, { icon: string; color: "warning" | "success" | "error" }> = {
  running: { icon: "●", color: "warning" },
  success: { icon: "✓", color: "success" },
  error: { icon: "✗", color: "error" },
};

/** Narrowest summary still worth keeping beside the right part, in columns. Baseline of `cutSummary`. */
const MIN_SUMMARY = 8;

/**
 * The meta and duration column: dim, except the diff counts, which take the added and removed colors so `+16 −12`
 * reads at a glance.
 */
function paintRight(right: string, theme: Theme): string {
  return right
    .split(/([+−]\d+)/)
    .filter((part) => part !== "")
    .map((part) => {
      if (part.startsWith("+")) return theme.fg("toolDiffAdded", part);
      if (part.startsWith("−")) return theme.fg("toolDiffRemoved", part);
      return theme.fg("dim", part);
    })
    .join("");
}

/** One line while collapsed; the summary wrapped over as many lines as it needs when expanded. */
export function renderHeader(parts: HeaderParts, width: number, theme: Theme): string[] {
  if (width <= 0) return [""];

  const { icon, color } = ICONS[parts.status];
  const name = theme.bold(parts.name);
  const prefix = `${theme.fg(color, icon)} ${parts.nameColor === undefined ? name : theme.fg(parts.nameColor, name)}`;
  const prefixWidth = visibleWidth(prefix);
  const duration = parts.durationMs === undefined ? undefined : formatDuration(parts.durationMs);
  const right = [parts.meta, duration].filter((part): part is string => Boolean(part)).join(" · ");
  const summaryColor = parts.summaryColor ?? "accent";
  const paintSummary = (text: string) => theme.fg(summaryColor, text);

  if (parts.expanded) return wrapHeader(prefix, prefixWidth, parts.summary, right, paintSummary, width, theme);
  return [oneLineHeader(parts, prefix, prefixWidth, duration, right, paintSummary, width, theme)];
}

/**
 * The summary wrapped to the width, with the right part right-aligned on the first line when it leaves
 * at least {@link MIN_SUMMARY} columns for the summary, and closing the header on its own line otherwise.
 */
function wrapHeader(
  prefix: string,
  prefixWidth: number,
  summary: string,
  right: string,
  paintSummary: (text: string) => string,
  width: number,
  theme: Theme,
): string[] {
  const rightWidth = visibleWidth(right);
  const beside = rightWidth > 0 && width - prefixWidth - 1 - rightWidth - 2 >= MIN_SUMMARY;
  const textWidth = Math.max(1, width - prefixWidth - 1 - (beside ? rightWidth + 2 : 0));
  const segments = summary ? wrapTextWithAnsi(summary, textWidth) : [];
  const indent = " ".repeat(Math.min(prefixWidth + 1, Math.max(0, width - 1)));
  const lines =
    segments.length === 0
      ? [prefix]
      : segments.map((segment, index) =>
          index === 0 ? `${prefix} ${paintSummary(segment)}` : `${indent}${paintSummary(segment)}`,
        );

  if (rightWidth > 0) {
    if (beside) {
      const gap = width - visibleWidth(lines[0]) - rightWidth;
      lines[0] = `${lines[0]}${" ".repeat(gap)}${paintRight(right, theme)}`;
    } else if (rightWidth <= width) {
      lines.push(`${" ".repeat(width - rightWidth)}${paintRight(right, theme)}`);
    }
  }

  return lines.map((line) => truncateToWidth(line, width, "…"));
}

function oneLineHeader(
  parts: HeaderParts,
  prefix: string,
  prefixWidth: number,
  duration: string | undefined,
  right: string,
  paintSummary: (text: string) => string,
  width: number,
  theme: Theme,
): string {
  const compose = (summary: string, right: string): string | undefined => {
    const left = summary ? `${prefix} ${paintSummary(summary)}` : prefix;
    const leftWidth = visibleWidth(left);
    const rightText = paintRight(right, theme);
    const gap = width - leftWidth - visibleWidth(rightText);
    return gap >= 2 ? `${left}${" ".repeat(gap)}${rightText}` : undefined;
  };

  const composeWithoutRight = (summary: string): string | undefined => {
    const left = summary ? `${prefix} ${paintSummary(summary)}` : prefix;
    const leftWidth = visibleWidth(left);
    return leftWidth <= width ? `${left}${" ".repeat(width - leftWidth)}` : undefined;
  };

  const cutSummary = (summary: string, available: number): string | undefined => {
    if (!summary || available < MIN_SUMMARY) return undefined;
    return truncateToWidth(summary, available, "…");
  };

  const tryRight = (candidate: string): string | undefined => {
    const full = compose(parts.summary, candidate);
    if (full) return full;
    const available = width - prefixWidth - 3 - visibleWidth(candidate);
    const cut = cutSummary(parts.summary, available);
    return cut === undefined ? undefined : compose(cut, candidate);
  };

  if (right) {
    const full = tryRight(right);
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

  const left = parts.summary ? `${prefix} ${paintSummary(parts.summary)}` : prefix;
  return truncateToWidth(left, width, "…");
}
