import { rawKeyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { BTW_BORDER } from "../shared/btw.ts";
import { formatDuration } from "../shared/format.ts";
import { frameBottom, frameRow, frameTop, joinHints } from "../shared/frame.ts";
import { type BtwThread, type BtwTurn, messageText } from "./thread.ts";

/** The question being answered right now, with whatever has streamed in so far. */
export interface PendingExchange {
  question: string;
  answer: string;
  elapsedMs: number;
  spinner: string;
}

export interface DrawerInput {
  /** The thread shown, or null for a new thread whose first question is not asked yet. */
  thread: BtwThread | null;
  /** The thread's place in the session's thread list, for the title. */
  number: number;
  /** User turns the main session has now, for the "turns behind" mark. */
  mainTurns: number;
  pending?: PendingExchange;
  /** First body row to show; undefined follows the newest row. */
  top?: number;
  /** Rows the drawer may use, borders included. */
  maxHeight: number;
  width: number;
  theme: Theme;
  markdown: MarkdownTheme;
}

export interface DrawerOutput {
  lines: string[];
  /** The first body row actually shown, after clamping. */
  top: number;
  /** The `top` that shows the newest row. */
  maxTop: number;
  /** Body rows on screen, the page size for keyboard scrolling. */
  pageRows: number;
}

/** The tallest the drawer may get: half the screen, at most 16 rows. */
export function drawerMaxHeight(rows: number): number {
  return Math.max(6, Math.min(16, Math.ceil(rows * 0.5)));
}

const LABEL_WIDTH = 4;
const INDENT = " ".repeat(LABEL_WIDTH);

/** Content width inside `│ … │`. */
function bodyWidth(width: number): number {
  return Math.max(1, width - 4);
}

/** `you ` / `btw ` before the first row, the same indent before the rest. */
function labelled(label: string, rows: readonly string[], width: number): string[] {
  return rows.map((row, index) => truncateToWidth(`${index === 0 ? label : INDENT}${row}`, width, "", true));
}

function questionRows(question: string, width: number, theme: Theme): string[] {
  const rows = wrapTextWithAnsi(question.trim() || "(empty)", Math.max(1, width - LABEL_WIDTH));
  return labelled(`${theme.fg("accent", "you")} `, rows, width);
}

function answerRows(answer: string, width: number, theme: Theme, markdown: MarkdownTheme): string[] {
  const rows = new Markdown(answer.trim() || "(empty answer)", 0, 0, markdown).render(Math.max(1, width - LABEL_WIDTH));
  while (rows.length > 1 && rows[rows.length - 1].trim() === "") rows.pop();
  return labelled(`${theme.fg("success", "btw")} `, rows, width);
}

/** `8.9k` style counts for the usage row. */
function compactTokens(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

function usageRow(turn: BtwTurn, width: number, theme: Theme): string {
  const usage = turn.message.usage;
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
  const parts = [
    turn.message.model,
    formatDuration(turn.durationMs),
    `${compactTokens(usage.totalTokens || prompt + usage.output)} tok`,
    `cache ${compactTokens(usage.cacheRead)}/${compactTokens(prompt)}`,
  ];
  return truncateToWidth(`${INDENT}${theme.fg("dim", parts.join(" · "))}`, width, "", true);
}

/** Markdown is the costly part and a stored turn never changes, so each turn keeps its rows per width. */
const turnCache = new WeakMap<BtwTurn, { width: number; theme: Theme; rows: string[] }>();

function turnRows(turn: BtwTurn, width: number, theme: Theme, markdown: MarkdownTheme): string[] {
  const cached = turnCache.get(turn);
  if (cached && cached.width === width && cached.theme === theme) return cached.rows;
  const rows = [
    ...questionRows(turn.question, width, theme),
    ...answerRows(messageText(turn.message), width, theme, markdown),
    usageRow(turn, width, theme),
  ];
  turnCache.set(turn, { width, theme, rows });
  return rows;
}

function pendingRows(pending: PendingExchange, width: number, theme: Theme, markdown: MarkdownTheme): string[] {
  const spinner = theme.fg("accent", pending.spinner);
  const elapsed = formatDuration(pending.elapsedMs);
  const rows = questionRows(pending.question, width, theme);
  if (pending.answer.trim() === "") {
    rows.push(
      ...labelled(`${theme.fg("success", "btw")} `, [`${spinner} ${theme.fg("dim", `answering · ${elapsed}`)}`], width),
    );
    return rows;
  }
  rows.push(...answerRows(pending.answer, width, theme, markdown));
  rows.push(truncateToWidth(`${INDENT}${spinner} ${theme.fg("dim", elapsed)}`, width, "", true));
  return rows;
}

/** `@turn 3 · main 8 (+5)`, the `(+5)` in warning color once the main session moved on. */
function anchorMeta(thread: BtwThread | null, mainTurns: number, theme: Theme): string {
  const anchor = thread?.anchorTurns ?? mainTurns;
  const base = theme.fg("dim", `@turn ${anchor} · main ${mainTurns}`);
  const behind = mainTurns - anchor;
  return behind > 0 ? `${base} ${theme.fg("warning", `(+${behind})`)}` : base;
}

/** Most important first; a hint that does not fit is dropped whole instead of cut mid-word. */
function hints(pending: boolean, scrolls: boolean, room: number, theme: Theme): string {
  const all = pending
    ? [rawKeyHint("esc", "stop")]
    : [
        rawKeyHint("enter", "ask"),
        rawKeyHint("esc", "close"),
        ...(scrolls ? [rawKeyHint("shift+↑↓", "scroll")] : []),
        rawKeyHint("/btw", "threads"),
      ];
  const kept: string[] = [];
  for (const hint of all) {
    if (visibleWidth(joinHints(theme, [...kept, hint])) > room) break;
    kept.push(hint);
  }
  return joinHints(theme, kept);
}

function position(above: number, below: number, theme: Theme): string | undefined {
  const parts = [...(above > 0 ? [`↑ ${above}`] : []), ...(below > 0 ? [`↓ ${below}`] : [])];
  return parts.length > 0 ? theme.fg("dim", parts.join(" ")) : undefined;
}

/**
 * The side thread as a drawer above the editor. It takes only the rows its content needs, follows the
 * newest row unless scrolled, and shares its border color with the editor while btw mode is on.
 */
export function renderBtw(input: DrawerInput): DrawerOutput {
  const { thread, number, mainTurns, pending, maxHeight, width, theme, markdown } = input;
  const inner = bodyWidth(width);
  const rows = (thread?.turns ?? []).flatMap((turn) => turnRows(turn, inner, theme, markdown));
  if (pending) rows.push(...pendingRows(pending, inner, theme, markdown));
  if (rows.length === 0) {
    rows.push(
      truncateToWidth(theme.fg("dim", "Ask a side question. It sees the main session up to now."), inner, "", true),
    );
  }

  const pageRows = Math.max(1, Math.min(maxHeight - 2, rows.length));
  const maxTop = rows.length - pageRows;
  const top = Math.max(0, Math.min(input.top ?? maxTop, maxTop));
  const body = rows.slice(top, top + pageRows).map((row) => frameRow(row, width, theme, BTW_BORDER));
  const scrolled = position(top, maxTop - top, theme);
  // A border label costs its width plus three cells, and one dash stays between the two labels.
  const hintRoom = width - 2 - 1 - 3 - (scrolled ? visibleWidth(scrolled) + 3 : 0);

  return {
    lines: [
      frameTop(width, theme, BTW_BORDER, {
        left: theme.fg("accent", `btw #${number}`),
        right: anchorMeta(thread, mainTurns, theme),
      }),
      ...body,
      frameBottom(width, theme, BTW_BORDER, {
        left: hints(pending !== undefined, maxTop > 0, hintRoom, theme),
        right: scrolled,
      }),
    ],
    top,
    maxTop,
    pageRows,
  };
}
