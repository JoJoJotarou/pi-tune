import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { frameBottom, frameRow, frameTop, joinHints } from "../shared/frame.ts";
import { type BtwThread, turnAnswer } from "./thread.ts";

export interface DrawerInput {
  thread: BtwThread | null;
  /** User turns the main session has now, for the "turns behind" hint. */
  mainTurns: number;
  composing: boolean;
  /** Rows the drawer may use, borders included. */
  maxHeight: number;
  width: number;
  theme: Theme;
}

/** The tallest the drawer may get: a readable share of the screen, or almost all of it when expanded. */
export function drawerMaxHeight(rows: number, expanded: boolean): number {
  if (expanded) return Math.max(8, rows - 6);
  return Math.max(6, Math.min(12, Math.ceil(rows * 0.4)));
}

function label(theme: Theme, text: string): string {
  return theme.fg("dim", text);
}

/** `8.9k` style counts for the meta row. */
function compactTokens(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

function metaLine(turn: BtwThread["turns"][number], width: number, theme: Theme): string {
  const usage = turn.message.usage;
  const parts = [
    `${turn.message.provider}/${turn.message.model}`,
    `${compactTokens(usage.totalTokens || usage.input + usage.output)} tok`,
  ];
  if (usage.cacheRead > 0) parts.push(`cache ${compactTokens(usage.cacheRead)}`);
  return truncateToWidth(label(theme, parts.join(" · ")), width);
}

/** One exchange: `you` question, `btw` answer, and — expanded — a usage row. */
function turnLines(turn: BtwThread["turns"][number], width: number, theme: Theme, expanded: boolean): string[] {
  const labelWidth = 4;
  const bodyWidth = Math.max(1, width - labelWidth);
  const question = wrapTextWithAnsi(turn.question.trim() || "(empty)", bodyWidth);
  const answer = wrapTextWithAnsi(turnAnswer(turn).trim() || "(empty answer)", bodyWidth);
  const indent = " ".repeat(labelWidth);
  const lines = [
    `${theme.fg("accent", "you")} ${truncateToWidth(question[0] ?? "", bodyWidth)}`,
    ...question.slice(1).map((line) => `${indent}${line}`),
    `${theme.fg("success", "btw")} ${truncateToWidth(answer[0] ?? "", bodyWidth)}`,
    ...answer.slice(1).map((line) => `${indent}${line}`),
  ];
  if (expanded) lines.push(`${indent}${metaLine(turn, bodyWidth, theme)}`);
  return lines.map((line) => truncateToWidth(line, width, "", true));
}

function staleLine(thread: BtwThread, mainTurns: number, width: number, theme: Theme): string | undefined {
  const behind = mainTurns - thread.anchorTurns;
  if (behind <= 0) return undefined;
  return truncateToWidth(
    theme.fg(
      "warning",
      `⚠ @turn ${thread.anchorTurns} — main turns ${thread.anchorTurns + 1}-${mainTurns} are not in this thread`,
    ),
    width,
    "",
    true,
  );
}

/**
 * The side thread as a drawer above the editor. It only takes the rows its content needs, and cuts at
 * the top when the thread is longer, so the newest exchange always stays visible.
 */
export function renderBtw(input: DrawerInput): string[] {
  const { thread, mainTurns, composing, maxHeight, width, theme } = input;
  const rows: string[] = [];

  if (!thread) {
    rows.push(truncateToWidth(theme.fg("dim", "/btw <question> starts a side thread."), width, "", true));
  } else {
    const stale = staleLine(thread, mainTurns, width, theme);
    const expanded = maxHeight > 12;
    const lines = thread.turns.flatMap((turn) => turnLines(turn, width, theme, expanded));
    if (lines.length === 0) {
      rows.push(truncateToWidth(theme.fg("dim", "No question asked in this thread yet."), width, "", true));
    }
    rows.push(...lines);
    if (stale) rows.push(stale);
  }

  const height = Math.max(4, Math.min(maxHeight, rows.length + 2));
  const fit = rows.slice(-(height - 2));
  while (fit.length < height - 2) fit.push("");
  const body = fit.map((row) => frameRow(row, width, theme, "borderMuted"));

  const title = thread ? `${theme.fg("accent", "btw")} · ${thread.id}` : theme.fg("accent", "btw");
  const meta = thread ? label(theme, `@turn ${thread.anchorTurns} · main ${mainTurns}`) : undefined;
  const hints = joinHints(
    theme,
    composing ? ["enter send", "ctrl+shift+b leave"] : ["ctrl+shift+b ask", "/btw:threads switch", "/btw:new fresh"],
  );

  return [
    frameTop(width, theme, "borderMuted", { left: title, right: meta }),
    ...body,
    frameBottom(width, theme, "borderMuted", { left: hints }),
  ];
}
