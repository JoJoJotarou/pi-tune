import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface FooterStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Cache hit rate of the latest assistant message, percent. */
  cacheHitPercent?: number;
  cost: number;
  contextPercent: number | null;
  contextWindow: number;
  autoCompact: boolean;
  /** Output tokens per second of the streaming or last finished assistant message. */
  rate?: number;
}

export interface FooterParts {
  /** Cwd basename, never the full path. */
  project: string;
  branch?: string;
  hints?: string;
  stats: FooterStats;
  /** Extension statuses as `[key, text]`, shown on a second line when any exist. */
  statuses?: readonly (readonly [key: string, text: string])[];
}

/** Compact token counts exactly like Pi's footer: `999`, `1.5k`, `12k`, `1.2M`. */
export function compactNumber(count: number): string {
  if (count < 1000) return Math.round(count).toString();
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

/**
 * Output tokens per second since the first text or thinking token, or `undefined` before one second
 * of streaming or before any token.
 */
export function streamRate(outputTokens: number, startedAt: number, now: number): number | undefined {
  if (startedAt <= 0 || outputTokens <= 0) return undefined;
  const elapsedMs = now - startedAt;
  if (elapsedMs < 1000) return undefined;
  return Math.round(outputTokens / (elapsedMs / 1000));
}

export interface StatsOptions {
  cost?: boolean;
  cache?: boolean;
}

/** Pi's native stat line, without extensions' experimental marker or subscription suffix. */
export function formatStats(stats: FooterStats, options: StatsOptions = {}): string {
  const fields: string[] = [];
  if (stats.input > 0) fields.push(`↑${compactNumber(stats.input)}`);
  if (stats.output > 0) fields.push(`↓${compactNumber(stats.output)}`);
  if (options.cache ?? true) {
    if (stats.cacheRead > 0) fields.push(`R${compactNumber(stats.cacheRead)}`);
    if (stats.cacheWrite > 0) fields.push(`W${compactNumber(stats.cacheWrite)}`);
    if ((stats.cacheRead > 0 || stats.cacheWrite > 0) && stats.cacheHitPercent != null) {
      fields.push(`CH${stats.cacheHitPercent.toFixed(1)}%`);
    }
  }
  if ((options.cost ?? true) && stats.cost > 0) fields.push(`$${stats.cost.toFixed(3)}`);

  const percent = stats.contextPercent == null ? "?" : `${stats.contextPercent.toFixed(1)}%`;
  const context = `${percent}/${compactNumber(stats.contextWindow)}${stats.autoCompact ? " (auto)" : ""}`;
  let text = fields.length > 0 ? `${fields.join(" ")} · ${context}` : context;
  if (stats.rate != null && Number.isFinite(stats.rate) && stats.rate > 0) {
    text += ` · ${Math.round(stats.rate)} tok/s`;
  }
  return text;
}

interface LayoutOptions {
  hints: boolean;
  cost: boolean;
  cache: boolean;
  branch: boolean;
}

/** Pi's one-line status sanitation: no control characters, no repeated spaces. */
function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function footerLines(line: string, statuses: FooterParts["statuses"], width: number, theme: Theme): string[] {
  const lines = [line];
  if (statuses && statuses.length > 0) {
    const text = [...statuses]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => sanitizeStatusText(value))
      .join(" ");
    lines.push(truncateToWidth(theme.fg("dim", text), width, theme.fg("dim", "...")));
  }
  return lines;
}

export function footerLine(parts: FooterParts, width: number, theme: Theme): string[] {
  if (width <= 0) return [""];

  const branchSuffix = parts.branch ? ` (${parts.branch})` : "";
  const build = (layout: LayoutOptions): string | undefined => {
    const left = theme.fg("muted", parts.project + (layout.branch ? branchSuffix : ""));
    const right = theme.fg("dim", formatStats(parts.stats, { cost: layout.cost, cache: layout.cache }));
    const hints = layout.hints ? (parts.hints ?? "") : "";
    const leftWidth = visibleWidth(left);
    const rightWidth = visibleWidth(right);
    const hintWidth = visibleWidth(hints);
    const gap = hints ? 4 : 2;
    if (leftWidth + rightWidth + hintWidth + gap > width) return undefined;
    if (hints) {
      const spare = width - leftWidth - rightWidth - hintWidth;
      const before = Math.floor(spare / 2);
      return left + " ".repeat(before) + hints + " ".repeat(spare - before) + right;
    }
    return left + " ".repeat(width - leftWidth - rightWidth) + right;
  };

  const attempts: LayoutOptions[] = [
    { hints: true, cost: true, cache: true, branch: true },
    { hints: false, cost: true, cache: true, branch: true },
    { hints: false, cost: false, cache: true, branch: true },
    { hints: false, cost: false, cache: false, branch: true },
    { hints: false, cost: false, cache: false, branch: false },
  ];
  for (const attempt of attempts) {
    const line = build(attempt);
    if (line !== undefined) return footerLines(line, parts.statuses, width, theme);
  }

  const left = theme.fg("muted", parts.project);
  const right = theme.fg("dim", formatStats(parts.stats, { cost: false, cache: false }));
  return footerLines(truncateToWidth(`${left}  ${right}`, width), parts.statuses, width, theme);
}
