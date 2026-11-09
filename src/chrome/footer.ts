import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatDuration } from "../shared/format.ts";

export interface FooterStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Cache hit rate of the latest assistant message, percent. */
  cacheHitPercent?: number;
  cost: number;
  /** Estimated tokens currently in the context window, or null when unknown. */
  contextTokens: number | null;
  contextPercent: number | null;
  contextWindow: number;
  /** Output tokens per second of the streaming or last finished assistant message. */
  rate?: number;
  /** Wait of the latest model request for its first token, in milliseconds. */
  ttftMs?: number;
}

export interface FooterParts {
  /** Cwd basename: the fallback name when the full path does not fit the identity row. */
  project: string;
  /** The cwd in full, drawn instead of `project` when the identity row can take it. */
  cwd?: string;
  branch?: string;
  hints?: string;
  stats: FooterStats;
  /** The model and thinking level: Pi draws them on the editor, which the block editor no longer has. */
  identity?: FooterIdentity;
  /** Extension statuses as `[key, text]`, shown on a second line when any exist. */
  statuses?: readonly (readonly [key: string, text: string])[];
}

/** Pi's thinking level, as `Theme.getThinkingBorderColor` takes it. */
export type ThinkingLevelName = Parameters<Theme["getThinkingBorderColor"]>[0];

export interface FooterIdentity {
  model: string;
  thinking: string;
  /** Picks Pi's own `thinkingOff`…`thinkingMax` color for the level, never a color of pi-tune's. */
  level: ThinkingLevelName;
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

/** `32%`: whole percent once it matters, one decimal below ten so small readings stay visible. */
export function formatContextPercent(percent: number | null): string {
  if (percent == null) return "?";
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/** `32% (315k/1.0M)`: the share, the estimated tokens in the window, and the window itself. */
export function formatContextReading(stats: FooterStats): string {
  const percent = formatContextPercent(stats.contextPercent);
  const tokens = stats.contextTokens == null ? "?" : compactNumber(stats.contextTokens);
  return `${percent} (${tokens}/${compactNumber(stats.contextWindow)})`;
}

/** Pi's one-line status sanitation: no control characters, no repeated spaces. */
function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, " ")
    .replace(/ +/g, " ")
    .trim();
}

function statusLines(statuses: FooterParts["statuses"], width: number, theme: Theme): string[] {
  if (!statuses || statuses.length === 0) return [];
  const text = [...statuses]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => sanitizeStatusText(value))
    .join(" ");
  return [truncateToWidth(theme.fg("dim", text), width, theme.fg("dim", "..."))];
}

function identityText(parts: FooterParts, theme: Theme): string {
  if (parts.identity === undefined) return "";
  return (
    theme.fg("muted", parts.identity.model) +
    theme.fg("dim", " · ") +
    theme.getThinkingBorderColor(parts.identity.level)(parts.identity.thinking)
  );
}

/** A row with `left` at the start and `right` against its last column, padded to exactly `usable`. */
function justify(left: string, right: string, usable: number): string | undefined {
  const leftWidth = visibleWidth(left);
  if (right === "") return left + " ".repeat(Math.max(0, usable - leftWidth));
  const gap = usable - leftWidth - visibleWidth(right);
  if (gap < 2) return undefined;
  return left + " ".repeat(gap) + right;
}

/** `feat/footer-layout` → `feat/…layout`: keep both ends of a branch that cannot take the whole row. */
function elideMiddle(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;
  if (width <= 1) return "…";
  const left = Math.ceil((width - 1) / 2);
  const right = Math.floor((width - 1) / 2);
  return sliceByColumn(text, 0, left) + "…" + sliceByColumn(text, visibleWidth(text) - right, right);
}

/**
 * Row 1: cwd/branch left, model and thinking level right. The cwd is its full path while the row can take it and
 * its project name once it cannot; the branch yields its middle before the row falls back to the shorter name.
 */
function identityRow(parts: FooterParts, right: string, usable: number, theme: Theme): string {
  const tinted = (text: string): string => theme.fg("muted", text);
  const names = parts.cwd !== undefined && parts.cwd !== parts.project ? [parts.cwd, parts.project] : [parts.project];
  const labelled = (name: string): string => (parts.branch ? `${name} (${parts.branch})` : name);
  const candidates: (string | undefined)[] = [];
  // The model stays on the row as long as any name leaves room for it.
  if (right !== "") {
    for (const name of names) {
      candidates.push(justify(tinted(labelled(name)), right, usable));
      const budget = usable - 2 - visibleWidth(right) - visibleWidth(name) - 3;
      if (parts.branch && budget >= 4) {
        candidates.push(justify(tinted(`${name} (${elideMiddle(parts.branch, budget)})`), right, usable));
      }
      candidates.push(justify(tinted(name), right, usable));
    }
  }
  // Without the model, only an uncut name beats the shorter one: a cut path names nothing.
  for (const name of names) {
    if (visibleWidth(labelled(name)) <= usable) candidates.push(justify(tinted(labelled(name)), "", usable));
    if (visibleWidth(name) <= usable) candidates.push(justify(tinted(name), "", usable));
  }
  const line = candidates.find((candidate): candidate is string => candidate !== undefined);
  return truncateToWidth(line ?? tinted(labelled(parts.project)), usable);
}

/** Row 2: key hints left, the DSH-style token, speed, and context pills right. */
function pillRow(parts: FooterParts, usable: number, theme: Theme): string {
  const stats = parts.stats;
  const muted = (text: string) => theme.fg("muted", text);
  const dim = (text: string) => theme.fg("dim", text);
  const accent = (text: string) => theme.fg("accent", text);
  const join = (...items: string[]): string => items.filter((item) => item !== "").join(` ${dim("·")} `);
  const pill = (content: string): string => theme.bg("toolPendingBg", ` ${content} `);

  const total = stats.input + stats.cacheRead + stats.cacheWrite + stats.output;
  const hit = stats.cacheHitPercent == null ? "" : `${Math.round(stats.cacheHitPercent)}%`;
  const cost = stats.cost > 0 ? `$${stats.cost.toFixed(2)}` : "";
  const tokenIcon = `${accent("▤")} ${muted(`${compactNumber(total)} tok`)}`;
  const tokenFull =
    total > 0 ? pill(join(tokenIcon, hit === "" ? "" : muted(hit), cost === "" ? "" : muted(cost))) : "";
  const tokenCompact = total > 0 ? pill(join(tokenIcon, hit === "" ? "" : muted(hit))) : "";
  const tokenMini = total > 0 ? pill(tokenIcon) : "";

  const rate =
    stats.rate != null && Number.isFinite(stats.rate) && stats.rate > 0 ? `${Math.round(stats.rate)} tok/s` : "";
  const ttft = stats.ttftMs != null ? `TTFT ${formatDuration(stats.ttftMs)}` : "";
  const speedFull = rate === "" ? "" : pill(join(`${accent("↯")} ${muted(rate)}`, ttft === "" ? "" : muted(ttft)));
  const speedCompact = rate === "" ? "" : pill(`${accent("↯")} ${muted(rate)}`);

  const percent = stats.contextPercent;
  const contextColor: "dim" | "text" | "warning" | "error" =
    percent == null ? "dim" : percent >= 90 ? "error" : percent >= 70 ? "warning" : "text";
  const contextLabel = formatContextPercent(percent);
  const used = stats.contextTokens == null ? "?" : compactNumber(stats.contextTokens);
  const contextFull = pill(
    `${accent("◔")} ${theme.fg(contextColor, contextLabel)} ${dim(`(${used}/${compactNumber(stats.contextWindow)})`)}`,
  );
  const contextCompact = pill(`${accent("◔")} ${theme.fg(contextColor, contextLabel)}`);

  const sets: (readonly string[])[] = [
    [tokenFull, speedFull, contextFull],
    [tokenCompact, speedFull, contextFull],
    [tokenCompact, speedCompact, contextFull],
    [tokenCompact, speedCompact, contextCompact],
    // Tokens and context stay; speed is the transient field, so it yields before either.
    [tokenCompact, contextFull],
    [tokenCompact, contextCompact],
    [tokenMini, contextCompact],
    [speedCompact, contextCompact],
    [contextCompact],
  ];
  const hints = parts.hints ?? "";
  for (const withHints of [true, false]) {
    if (withHints && hints === "") continue;
    for (const set of sets) {
      const groups = set.filter((group) => group !== "");
      if (groups.length === 0) continue;
      const pills = groups.join("  ");
      const left = withHints ? hints : "";
      const gap = left === "" ? 0 : 2;
      if (visibleWidth(left) + visibleWidth(pills) + gap > usable) continue;
      const row =
        left === ""
          ? " ".repeat(usable - visibleWidth(pills)) + pills
          : left + " ".repeat(usable - visibleWidth(left) - visibleWidth(pills)) + pills;
      return truncateToWidth(row, usable);
    }
  }
  return truncateToWidth(hints === "" ? " ".repeat(usable) : hints, usable);
}

export function footerLine(parts: FooterParts, width: number, theme: Theme): string[] {
  if (width <= 0) return [""];
  // The input block spans the full width, so the footer does too: its right edge lines up with the block.
  const usable = Math.max(1, width);
  const row1 = identityRow(parts, identityText(parts, theme), usable, theme);
  const row2 = pillRow(parts, usable, theme);
  return [row1, row2, ...statusLines(parts.statuses, width, theme)];
}
