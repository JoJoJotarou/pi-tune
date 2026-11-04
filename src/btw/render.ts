import type { AssistantMessage } from "@earendil-works/pi-ai";
import { rawKeyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { BTW_BORDER } from "../shared/btw.ts";
import { formatDuration } from "../shared/format.ts";
import { frameBottom, frameRow, frameTop, joinHints } from "../shared/frame.ts";
import { type BtwThread, type BtwTurn, messageText, turnReply } from "./thread.ts";

/** The question being answered right now, with whatever has streamed in so far. */
export interface PendingExchange {
  question: string;
  answer: string;
  /** What the side thread is doing: `Working`, `Thinking`, `Responding`, or the tool call that runs. */
  phase: string;
  /** The phase is a call the rules just refused, shown in warning color until the next phase starts. */
  blocked?: boolean;
  elapsedMs: number;
  spinner: string;
}

/**
 * The model's phase from a stream event, in the words of the main session's status line. Writing a tool call reads
 * as `Working` until the call runs and names itself.
 */
export function streamPhase(type: string): string | undefined {
  if (type.startsWith("thinking_")) return "Thinking";
  if (type.startsWith("text_")) return "Responding";
  if (type === "start" || type.startsWith("toolcall_")) return "Working";
  return undefined;
}

/** A tool call on one line: the tool and its command, pattern or path. */
export function activityLabel(tool: string, args: unknown): string {
  const field = (key: string) => {
    const value = (args as Record<string, unknown> | undefined)?.[key];
    return typeof value === "string" ? value : undefined;
  };
  const detail = tool === "bash" ? field("command") : (field("pattern") ?? field("path"));
  return (detail ? `${tool} ${detail}` : tool).replace(/\s+/g, " ").trim();
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

const PAD_X = 2;

/** Content width inside `│  …  │`. */
function bodyWidth(width: number): number {
  return Math.max(1, width - 2 - 2 * PAD_X);
}

/** The question in the user message colors, one cell of padding inside the block, like Pi's own user messages. */
function questionRows(question: string, width: number, theme: Theme): string[] {
  const text = Math.max(1, width - 2);
  return wrapTextWithAnsi(question.trim() || "(empty)", text).map((line) => {
    const fill = " ".repeat(Math.max(0, text - visibleWidth(line)));
    return theme.bg("userMessageBg", ` ${theme.fg("userMessageText", line)}${fill} `);
  });
}

function answerRows(answer: string, width: number, markdown: MarkdownTheme): string[] {
  const rows = new Markdown(answer.trim() || "(empty answer)", 0, 0, markdown).render(width);
  while (rows.length > 1 && rows[rows.length - 1].trim() === "") rows.pop();
  while (rows.length > 1 && rows[0].trim() === "") rows.shift();
  return rows.map((row) => truncateToWidth(row, width, "", true));
}

/** Every refused call, wrapped rather than cut, so each one can be copied into `btw.allow`. */
function blockedRows(denied: readonly string[], width: number, theme: Theme): string[] {
  if (denied.length === 0) return [];
  return wrapTextWithAnsi(`⚠ blocked: ${denied.join(", ")}`, Math.max(1, width - 2)).map((row, index) =>
    theme.fg("warning", index === 0 ? row : `  ${row}`),
  );
}

/** Markdown is the costly part and a stored turn never changes, so each turn keeps its rows per width. */
const turnCache = new WeakMap<BtwTurn, { width: number; theme: Theme; rows: string[] }>();

function turnRows(turn: BtwTurn, width: number, theme: Theme, markdown: MarkdownTheme): string[] {
  const cached = turnCache.get(turn);
  if (cached && cached.width === width && cached.theme === theme) return cached.rows;
  const rows = [
    ...questionRows(turn.question, width, theme),
    "",
    ...answerRows(messageText(turnReply(turn)), width, markdown),
    ...blockedRows(turn.denied, width, theme),
  ];
  turnCache.set(turn, { width, theme, rows });
  return rows;
}

function pendingRows(pending: PendingExchange, width: number, theme: Theme, markdown: MarkdownTheme): string[] {
  const elapsed = formatDuration(pending.elapsedMs);
  const phase = pending.blocked ? theme.fg("warning", `⚠ ${pending.phase} blocked`) : theme.fg("dim", pending.phase);
  const status = truncateToWidth(
    `${theme.fg("accent", pending.spinner)} ${phase}${theme.fg("dim", ` · ${elapsed}`)}`,
    width,
    "",
    true,
  );
  const rows = [...questionRows(pending.question, width, theme), ""];
  if (pending.answer.trim() === "") return [...rows, status];
  return [...rows, ...answerRows(pending.answer, width, markdown), status];
}

/** `4.2s · 98% cached · $0.004` over every request the turn made; the cost only when the model has a price. */
function turnStats(turn: BtwTurn, theme: Theme): string {
  const replies = turn.messages.filter((message): message is AssistantMessage => message.role === "assistant");
  const sum = (pick: (usage: AssistantMessage["usage"]) => number) =>
    replies.reduce((total, message) => total + pick(message.usage), 0);
  const prompt = sum((usage) => usage.input + usage.cacheRead + usage.cacheWrite);
  const cost = sum((usage) => usage.cost.total);
  const parts = [
    formatDuration(turn.durationMs),
    ...(prompt > 0 ? [`${Math.round((sum((usage) => usage.cacheRead) * 100) / prompt)}% cached`] : []),
    ...(cost > 0 ? [`$${cost.toFixed(3)}`] : []),
  ];
  return theme.fg("dim", parts.join(" · "));
}

/** `@turn 3 · main 8 (+5)`, the `(+5)` in warning color once the main session moved on. */
function anchorMeta(thread: BtwThread | null, mainTurns: number, theme: Theme): string {
  const anchor = thread?.anchorTurns ?? mainTurns;
  const base = theme.fg("dim", `@turn ${anchor} · main ${mainTurns}`);
  const behind = mainTurns - anchor;
  return behind > 0 ? `${base} ${theme.fg("warning", `(+${behind})`)}` : base;
}

/** Most important first; a hint that does not fit is dropped whole instead of cut mid-word. */
function fitHints(pending: boolean, scrolls: boolean, room: number, theme: Theme): string[] {
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
  return kept;
}

function position(above: number, below: number): string | undefined {
  const parts = [...(above > 0 ? [`↑ ${above}`] : []), ...(below > 0 ? [`↓ ${below}`] : [])];
  return parts.length > 0 ? parts.join(" ") : undefined;
}

/**
 * The side thread as a drawer above the editor, laid out like the main session: the question in a user message
 * block, the answer below it, an empty row around each. It takes only the rows its content needs, follows the
 * newest row unless scrolled, and shares its border color with the editor while btw mode is on.
 */
export function renderBtw(input: DrawerInput): DrawerOutput {
  const { thread, number, mainTurns, pending, maxHeight, width, theme, markdown } = input;
  const inner = bodyWidth(width);
  const rows: string[] = [];
  for (const turn of thread?.turns ?? []) {
    if (rows.length > 0) rows.push("");
    rows.push(...turnRows(turn, inner, theme, markdown));
  }
  if (pending) {
    if (rows.length > 0) rows.push("");
    rows.push(...pendingRows(pending, inner, theme, markdown));
  }
  if (rows.length === 0) {
    rows.push(
      truncateToWidth(theme.fg("dim", "Ask a side question. It sees the main session up to now."), inner, "", true),
    );
  }

  // Two borders and the empty row under the drawer always; the padding rows only while three content rows remain.
  const padded = maxHeight - 5 >= 3;
  const pageRows = Math.max(1, Math.min(maxHeight - (padded ? 5 : 3), rows.length));
  const maxTop = rows.length - pageRows;
  const top = Math.max(0, Math.min(input.top ?? maxTop, maxTop));
  const frame = (row: string) => frameRow(row, width, theme, BTW_BORDER, PAD_X);
  const padding = padded ? [frame("")] : [];

  // The usage gives way first when the bottom border is too narrow for the main hints.
  // The last finished answer's usage stays while the next one runs, and is replaced once that one finishes.
  const latest = thread?.turns.at(-1);
  const scrolled = position(top, maxTop - top);
  const bottomRight = (withStats: boolean) => {
    const parts = [
      ...(scrolled ? [theme.fg("dim", scrolled)] : []),
      ...(withStats && latest ? [turnStats(latest, theme)] : []),
    ];
    return parts.length > 0 ? parts.join(theme.fg("dim", " · ")) : undefined;
  };
  // A border label costs its width plus three cells, and one dash stays between the two labels.
  const room = (label: string | undefined) => width - 2 - 1 - 3 - (label ? visibleWidth(label) + 3 : 0);
  let right = bottomRight(true);
  let hints = fitHints(pending !== undefined, maxTop > 0, room(right), theme);
  if (latest && hints.length < (pending ? 1 : 2)) {
    right = bottomRight(false);
    hints = fitHints(pending !== undefined, maxTop > 0, room(right), theme);
  }

  return {
    lines: [
      frameTop(width, theme, BTW_BORDER, {
        left: theme.fg("accent", `btw #${number}`),
        right: anchorMeta(thread, mainTurns, theme),
      }),
      ...padding,
      ...rows.slice(top, top + pageRows).map(frame),
      ...padding,
      frameBottom(width, theme, BTW_BORDER, { left: joinHints(theme, hints), right }),
      "",
    ],
    top,
    maxTop,
    pageRows,
  };
}
