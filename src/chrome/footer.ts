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
  /** Assistant messages that reported usage: the request count the cumulative pill prints. */
  requests: number;
  /** Output tokens and cache hit rate of the latest request, which the turn pill prints. */
  lastRequest?: { output: number; cacheHitPercent: number };
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
 * Row 1: cwd and branch left, model and thinking level right. The git counts stay while any spelling of the name
 * and branch can carry them: the path first, then the branch elided, then the project name; once no spelling fits,
 * the counts go and the path comes back. Without counts the cwd is its home-relative path while the row can take it
 * and its project name once it cannot.
 */
function identityRow(parts: FooterParts, right: string, usable: number, theme: Theme): string {
  const tinted = (text: string): string => theme.fg("muted", text);
  const path = parts.cwd === undefined ? undefined : tildePath(parts.cwd, HOME);
  const names = path !== undefined && path !== parts.project ? [path, parts.project] : [parts.project];
  const git = parts.git === undefined ? "" : gitText(parts.git, theme);
  // The counts size the work, the branch names it: the counts are the first part of the label to go.
  const tails = git === "" ? [""] : [` ${git}`, ""];
  const labelled = (name: string, tail: string): string =>
    parts.branch ? `${name} · ⎇ ${parts.branch}${tail}` : `${name}${tail}`;
  const candidates: (string | undefined)[] = [];
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

/**
 * Row 2: key hints left, the three reading groups right. Each group answers one question and never borrows a
 * number from another: the cumulative group sums the whole session, the turn group describes the latest request,
 * and the context group measures the window right now.
 */
function pillRow(parts: FooterParts, usable: number, theme: Theme): string {
  const stats = parts.stats;
  const muted = (text: string) => theme.fg("muted", text);
  const dim = (text: string) => theme.fg("dim", text);
  const accent = (text: string) => theme.fg("accent", text);
  const join = (...items: string[]): string => items.filter((item) => item !== "").join(` ${dim("·")} `);
  const pill = (content: string): string => theme.bg("toolPendingBg", ` ${content} `);
  const counted = (count: number, unit: string): string => `${muted(compactNumber(count))}${dim(` ${unit}`)}`;

  // Cumulative: what the session has spent. No percentage, so nothing on this pill implies a share of anything.
  const total = stats.input + stats.cacheRead + stats.cacheWrite + stats.output;
  const cost = formatCost(stats.cost);
  const tokenIcon = `${accent("≡")} ${muted(`${compactNumber(total)} tok`)}`;
  // The breakdown adds up to `total` and repeats none of it: cache reads and output are the two buckets that
  // explain why a total this large cost so little, and what is left is the input the provider billed in full.
  // A zero stays off the row, the way the git counts do.
  const counts = [
    stats.requests > 0 ? counted(stats.requests, "req") : "",
    stats.cacheRead > 0 ? counted(stats.cacheRead, "cached") : "",
    stats.output > 0 ? counted(stats.output, "out") : "",
  ];
  const tokens =
    total > 0
      ? [
          pill(join(tokenIcon, ...counts, cost === "" ? "" : muted(cost))),
          pill(join(tokenIcon, counted(stats.requests, "req"), cost === "" ? "" : muted(cost))),
          pill(join(tokenIcon, cost === "" ? "" : muted(cost))),
          pill(tokenIcon),
          "",
        ]
      : [""];

  // Turn: the latest request on its own. Every number here comes from that one request.
  const rate =
    stats.rate != null && Number.isFinite(stats.rate) && stats.rate > 0 ? `${Math.round(stats.rate)} tok/s` : "";
  const ttft = stats.ttftMs != null ? `TTFT ${formatDuration(stats.ttftMs)}` : "";
  const last = stats.lastRequest;
  const hit = last === undefined ? "" : `${muted(`${Math.round(last.cacheHitPercent)}%`)}${dim(" hit")}`;
  const out = last === undefined || last.output === 0 ? "" : counted(last.output, "out");
  const speed = rate === "" ? "" : `${accent("↯")} ${muted(rate)}`;
  const turn =
    rate === ""
      ? [""]
      : [
          pill(join(speed, hit, ttft === "" ? "" : muted(ttft), out)),
          pill(join(speed, hit, ttft === "" ? "" : muted(ttft))),
          pill(join(speed, hit)),
          pill(speed),
          "",
        ];

  // Context: how full the window is right now, and the reading the percentage divides.
  const percent = stats.contextPercent;
  const contextColor: "dim" | "text" | "warning" | "error" =
    percent == null ? "dim" : percent >= 90 ? "error" : percent >= 70 ? "warning" : "text";
  const contextLabel = formatContextPercent(percent);
  const used = stats.contextTokens == null ? "?" : compactNumber(stats.contextTokens);
  const context = [
    pill(
      `${accent("◔")} ${theme.fg(contextColor, contextLabel)} ${dim(`(${used}/${compactNumber(stats.contextWindow)})`)}`,
    ),
    pill(`${accent("◔")} ${theme.fg(contextColor, contextLabel)}`),
  ];

  // Each rung is one field cheaper than the rung above it: the turn's extras go first, then the cumulative
  // details, then the turn pill itself, then the context reading, and the token total last.
  const groups = [tokens, turn, context];
  const rungs: readonly (readonly [number, number, number])[] = [
    [0, 0, 0],
    [0, 1, 0],
    [0, 2, 0],
    [0, 3, 0],
    [1, 3, 0],
    [1, 4, 0],
    [2, 4, 0],
    [3, 4, 0],
    [4, 4, 0],
    [4, 4, 1],
  ];
  const at = (rung: readonly [number, number, number]): string[] =>
    rung.map((index, group) => groups[group]?.[index] ?? "").filter((entry) => entry !== "");
  // A key hint shares the row only with the complete set: it is the first thing to go, before any reading does.
  const hints = parts.hints ?? "";
  for (const withHints of [true, false]) {
    if (withHints && hints === "") continue;
    for (const rung of withHints ? rungs.slice(0, 1) : rungs) {
      const pills = at(rung).join("  ");
      if (pills === "") continue;
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
