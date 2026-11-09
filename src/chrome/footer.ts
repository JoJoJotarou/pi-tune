import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatDuration } from "../shared/format.ts";
import type { GitState } from "./git.ts";

const HOME = homedir();

export interface FooterStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  /** Cache hit rate of the latest request's prompt, which the turn pill prints. */
  cacheHitPercent?: number;
  /** Estimated tokens currently in the context window, or null when unknown. */
  contextTokens: number | null;
  contextPercent: number | null;
  contextWindow: number;
  /** Output tokens per second of the streaming or last finished assistant message. */
  rate?: number;
  /** Wait of the latest model request for its first token, in milliseconds. */
  ttftMs?: number;
  /** Pi's `compaction.enabled`: the context pill says `auto` while a full window compacts itself. */
  autoCompact: boolean;
}

export interface FooterParts {
  /** Cwd basename: the fallback name when the full path does not fit the identity row. */
  project: string;
  /** The cwd in full, drawn instead of `project` when the identity row can take it. */
  cwd?: string;
  /** The session's display name (`/name`), drawn right after the cwd. */
  session?: string;
  branch?: string;
  /** The repository counts drawn after the branch: ahead/behind, then the line diff. */
  git?: GitState;
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
  /** Drawn as `(provider)` before the model, the way Pi's own footer does while more than one provider is available. */
  provider?: string;
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

/** Two decimals with thousands grouped, because a session that costs four figures should not push the row out. */
const COST_FORMAT = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `$0.42`, `$1,234.57`, and `<$0.01` for a cost that rounds to zero but was not free. Nothing at zero. */
export function formatCost(cost: number): string {
  if (!(cost > 0)) return "";
  if (cost < 0.01) return "<$0.01";
  return `$${COST_FORMAT.format(cost)}`;
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

function identityText(parts: FooterParts, theme: Theme, provider: boolean): string {
  if (parts.identity === undefined) return "";
  return (
    (provider && parts.identity.provider ? theme.fg("dim", `(${parts.identity.provider}) `) : "") +
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

/** `/Users/me/project` → `~/project`: shell's own shorthand, so the row spends its columns on the path. */
export function tildePath(path: string, home: string): string {
  if (home === "" || home === "/") return path;
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** `feat/footer-layout` → `feat/…layout`: keep both ends of a branch that cannot take the whole row. */
function elideMiddle(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;
  if (width <= 1) return "…";
  const left = Math.ceil((width - 1) / 2);
  const right = Math.floor((width - 1) / 2);
  return sliceByColumn(text, 0, left) + "…" + sliceByColumn(text, visibleWidth(text) - right, right);
}

/** `↑2 ↓1 +12 −3`: a push, a pull, the lines added and the lines removed. A zero count stays off the row. */
function gitText(git: GitState, theme: Theme): string {
  const parts: string[] = [];
  if (git.ahead > 0) parts.push(theme.fg("muted", `↑${git.ahead}`));
  if (git.behind > 0) parts.push(theme.fg("muted", `↓${git.behind}`));
  if (git.added > 0) parts.push(theme.fg("success", `+${git.added}`));
  if (git.deleted > 0) parts.push(theme.fg("error", `−${git.deleted}`));
  return parts.join(" ");
}

/**
 * Row 1: cwd, session name and branch left, provider, model and thinking level right. The provider goes first, then
 * the session name, which outlasts the longer path. Past that the git counts stay while any spelling of the name and
 * branch can carry them: the path first, then the branch elided, then the project name; once no spelling fits, the
 * counts go and the path comes back. Without counts the cwd is its home-relative path while the row can take it and
 * its project name once it cannot.
 */
function identityRow(parts: FooterParts, usable: number, theme: Theme): string {
  const tinted = (text: string): string => theme.fg("muted", text);
  const right = identityText(parts, theme, false);
  const path = parts.cwd === undefined ? undefined : tildePath(parts.cwd, HOME);
  const names = path !== undefined && path !== parts.project ? [path, parts.project] : [parts.project];
  const git = parts.git === undefined ? "" : gitText(parts.git, theme);
  // The counts size the work, the branch names it: the counts are the first part of the label to go.
  const tails = git === "" ? [""] : [` ${git}`, ""];
  const labelled = (name: string, tail: string, session = ""): string =>
    `${name}${session}${parts.branch ? ` · ⎇ ${parts.branch}` : ""}${tail}`;
  const candidates: (string | undefined)[] = [];
  const session = parts.session ? ` · ${parts.session}` : "";
  // `justify` pads a row without a right side to any length, so these candidates measure it themselves.
  const fit = (left: string, side: string): string | undefined =>
    side === "" && visibleWidth(left) > usable ? undefined : justify(left, side, usable);
  if (parts.identity !== undefined) {
    candidates.push(fit(tinted(labelled(names[0], tails[0], session)), identityText(parts, theme, true)));
  }
  if (session !== "") {
    for (const name of names) candidates.push(fit(tinted(labelled(name, tails[0], session)), right));
  }
  // The git counts outrank the longer name: a shorter name is tried before the counts are given up, because the
  // counts are what the row cannot learn any other way.
  if (right !== "") {
    for (const tail of tails) {
      for (const name of names) {
        candidates.push(justify(tinted(labelled(name, tail)), right, usable));
        // ` · ⎇ ` takes five columns and the tail takes its own before the branch gets any.
        const budget = usable - 2 - visibleWidth(right) - visibleWidth(name) - 5 - visibleWidth(tail);
        if (parts.branch && budget >= 4) {
          candidates.push(justify(tinted(`${name} · ⎇ ${elideMiddle(parts.branch, budget)}${tail}`), right, usable));
        }
      }
    }
    for (const name of names) candidates.push(justify(tinted(name), right, usable));
  }
  // Without the model, only an uncut name beats the shorter one: a cut path names nothing.
  for (const tail of tails) {
    for (const name of names) {
      if (visibleWidth(labelled(name, tail)) <= usable) {
        candidates.push(justify(tinted(labelled(name, tail)), "", usable));
      }
    }
  }
  for (const name of names) {
    if (visibleWidth(name) <= usable) candidates.push(justify(tinted(name), "", usable));
  }
  const line = candidates.find((candidate): candidate is string => candidate !== undefined);
  return truncateToWidth(line ?? tinted(labelled(parts.project, "")), usable);
}

type Field =
  | "speed"
  | "hit"
  | "ttft"
  | "cost"
  | "input"
  | "output"
  | "cacheRead"
  | "cacheWrite"
  | "percent"
  | "reading"
  | "auto"
  | "hints";

/**
 * What narrowing removes, one field per rung. Inside each pill the fields are written in this order's reverse, so a
 * pill always loses its last field. `percent` never leaves: how full the window is matters at any width.
 */
const DROP_ORDER: readonly Field[] = [
  "ttft",
  "cacheWrite",
  "cacheRead",
  "hints",
  "auto",
  "reading",
  "hit",
  "speed",
  "output",
  "input",
  "cost",
];

/** The widest rate the row plans for, so a rate gaining a digit mid-stream cannot flip the row to another rung. */
const WIDEST_RATE = "9999 tok/s";

/**
 * Row 2: key hints left, the three reading groups right. Each group answers one question and never borrows a
 * number from another: the turn group describes the latest request, the session group sums what the session spent,
 * and the context group measures the window right now. The turn group sits leftmost because its numbers move the
 * most: a change in its width only moves its own left edge, never the pills beside it.
 */
function pillRow(parts: FooterParts, usable: number, theme: Theme): string {
  const stats = parts.stats;
  const muted = (text: string) => theme.fg("muted", text);
  const dim = (text: string) => theme.fg("dim", text);
  const accent = (text: string) => theme.fg("accent", text);
  const valued = (value: string, unit: string): string => `${muted(value)}${dim(` ${unit}`)}`;

  const rate = stats.rate != null && Number.isFinite(stats.rate) && stats.rate > 0 ? Math.round(stats.rate) : undefined;
  // Pi's own footer spelling: `↑` input, `↓` output, `R` cache reads, `W` cache writes. A zero stays off the row.
  const count = (mark: string, tokens: number): string | undefined =>
    tokens > 0 ? `${dim(mark)}${muted(compactNumber(tokens))}` : undefined;
  const percent = stats.contextPercent;
  const contextColor: "dim" | "text" | "warning" | "error" =
    percent == null ? "dim" : percent >= 90 ? "error" : percent >= 70 ? "warning" : "text";
  const used = stats.contextTokens == null ? "?" : compactNumber(stats.contextTokens);

  const text: Partial<Record<Field, string>> = {
    speed: rate === undefined ? undefined : valued(String(rate), "tok/s"),
    hit: stats.cacheHitPercent == null ? undefined : valued(`${Math.round(stats.cacheHitPercent)}%`, "hit"),
    ttft: stats.ttftMs == null ? undefined : valued(formatDuration(stats.ttftMs), "TTFT"),
    cost: formatCost(stats.cost) === "" ? undefined : muted(formatCost(stats.cost)),
    input: count("↑", stats.input),
    output: count("↓", stats.output),
    cacheRead: count("R", stats.cacheRead),
    cacheWrite: count("W", stats.cacheWrite),
    percent: theme.fg(contextColor, formatContextPercent(percent)),
    reading: dim(`(${used}/${compactNumber(stats.contextWindow)})`),
    auto: stats.autoCompact ? dim("auto") : undefined,
    hints: parts.hints === "" ? undefined : parts.hints,
  };
  // A pill is a list of groups: groups part with ` · `, the fields inside one group with a space.
  const pills: readonly (readonly [icon: string, groups: readonly (readonly Field[])[]])[] = [
    ["↯", [["speed"], ["hit"], ["ttft"]]],
    ["≡", [["cost"], ["input", "output", "cacheRead", "cacheWrite"]]],
    ["◔", [["percent", "reading", "auto"]]],
  ];

  const draw = (shown: (field: Field) => string | undefined): string =>
    pills
      .map(([icon, groups]) => {
        const values = groups
          .map((fields) => fields.map(shown).filter((value): value is string => value !== undefined))
          .filter((group) => group.length > 0)
          .map((group) => group.join(" "));
        return values.length === 0
          ? ""
          : theme.bg("toolPendingBg", ` ${accent(icon)} ${values.join(` ${dim("·")} `)} `);
      })
      .filter((pill) => pill !== "")
      .join("  ");

  for (let rung = 0; rung <= DROP_ORDER.length; rung++) {
    const dropped = new Set(DROP_ORDER.slice(0, rung));
    const shown = (field: Field): string | undefined => (dropped.has(field) ? undefined : text[field]);
    const planned = (field: Field): string | undefined =>
      field === "speed" && shown(field) !== undefined ? WIDEST_RATE : shown(field);
    const left = shown("hints") ?? "";
    const gap = left === "" ? 0 : 2;
    if (visibleWidth(left) + gap + visibleWidth(draw(planned)) > usable) continue;
    const right = draw(shown);
    return left + " ".repeat(Math.max(0, usable - visibleWidth(left) - visibleWidth(right))) + right;
  }
  return truncateToWidth(
    draw((field) => (field === "percent" ? text.percent : undefined)),
    usable,
  );
}

export function footerLine(parts: FooterParts, width: number, theme: Theme): string[] {
  if (width <= 0) return [""];
  // The input block spans the full width, so the footer does too: its right edge lines up with the block.
  const usable = Math.max(1, width);
  const row1 = identityRow(parts, usable, theme);
  const row2 = pillRow(parts, usable, theme);
  return [row1, row2, ...statusLines(parts.statuses, width, theme)];
}
