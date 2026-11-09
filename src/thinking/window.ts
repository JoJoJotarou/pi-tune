/**
 * One-line rolling window for a thinking block.
 *
 * No pi imports: the visible-width function is injected (pi-tui's `visibleWidth`
 * at runtime) so `node --test` can run this file directly.
 *
 * The returned line goes through pi's Markdown parser again, so two things can
 * silently widen it past the budget and force a re-wrap:
 * 1. An unpaired backtick pairs with one on another rendered line into a code
 *    span; marked replaces the span's newlines with spaces, merging the lines.
 * 2. Inserted ANSI escapes get eaten by inline rules: the email autolink rule
 *    swallows a trailing `3m` as a mailbox user name, and an unpaired `](` turns
 *    the CSI `[` into a link's bracket. Both truncate the escape mid-sequence and
 *    leak it as visible text. Escaping `@` and unpaired `]` as `\@` / `\]` makes
 *    marked's escape rule restore them verbatim after rendering.
 */

export type WidthFn = (text: string) => number;

const LABEL = "◆ Thinking · ";
const ELLIPSIS = "…";
const ITALIC_OFF = "\x1b[23m";
const ITALIC_ON = "\x1b[3m";
/** The rolling line stops 3 columns short of the right edge; skipped when too narrow to still fit the label. */
const RIGHT_INSET = 3;
const MIN_CONTENT_WIDTH = 1;
const DEFAULT_WIDTH = 80;
/** Raw characters kept ahead of the clip: a slice this deep fills a row even at one column per character. */
const TAIL_CHARS_PER_COLUMN = 4;
const TAIL_MIN_CHARS = 256;
/** Comma inserted at paragraph seams between two CJK runs; folding inside a paragraph joins silently. */
const PARAGRAPH_JOIN_PUNCT = "，";

// marked only breaks lines at LF (with CRLF normalized); LS/PS cover the exotic Unicode separators.
const LINE_BREAK_RE = /\r\n|[\n\r\u2028\u2029]/;
const SPACE_RUN_RE = / {2,}/g;

function isWideChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6)
  );
}

function isCjkPunct(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 0x3000 && c <= 0x303f) return true;
  if (c >= 0xfe30 && c <= 0xfe6f) return true;
  if (c >= 0xff61 && c <= 0xff65) return true;
  if (c < 0xff01 || c > 0xff60) return false;
  const digit = c >= 0xff10 && c <= 0xff19;
  const upper = c >= 0xff21 && c <= 0xff3a;
  const lower = c >= 0xff41 && c <= 0xff5a;
  return !digit && !upper && !lower;
}

const NO_SPACE_AFTER = new Set(["(", "[", "{", "<", '"', "'", "`", "…", "—", "–", "·", "$"]);
const NO_SPACE_BEFORE = new Set([")", "]", "}", ">", ",", ".", ";", ":", "!", "?", "%", '"', "'", "`", "…"]);

function joinSeparator(prevEnd: string, nextStart: string, paragraphBreak: boolean): string {
  if (prevEnd === "" || nextStart === "") return "";
  if (isCjkPunct(prevEnd) || isCjkPunct(nextStart)) return "";
  if (isWideChar(prevEnd) && isWideChar(nextStart)) {
    return paragraphBreak ? PARAGRAPH_JOIN_PUNCT : "";
  }
  if (NO_SPACE_AFTER.has(prevEnd)) return "";
  if (NO_SPACE_BEFORE.has(nextStart)) return "";
  return " ";
}

/** Flatten every source line (blank lines mark paragraph seams) into one continuous string. */
export function joinAllLines(lines: readonly string[]): string {
  let out = "";
  let paragraphBreak = false;
  for (const line of lines) {
    const collapsed = line.trim().replace(SPACE_RUN_RE, " ");
    if (collapsed === "") {
      if (out !== "") paragraphBreak = true;
      continue;
    }
    if (out === "") {
      out = collapsed;
      continue;
    }
    out += joinSeparator(lastCodePoint(out), firstCodePoint(collapsed), paragraphBreak) + collapsed;
    paragraphBreak = false;
  }
  return out;
}

function lastCodePoint(text: string): string {
  if (text === "") return "";
  const start = prevCodePointStart(text, text.length);
  return text.slice(start);
}

function firstCodePoint(text: string): string {
  const first = text.charCodeAt(0);
  if (first >= 0xd800 && first <= 0xdbff && text.length >= 2) return text.slice(0, 2);
  return text.slice(0, 1);
}

function prevCodePointStart(text: string, end: number): number {
  if (end <= 1) return 0;
  const low = text.charCodeAt(end - 1);
  if (low >= 0xdc00 && low <= 0xdfff && end >= 2) {
    const high = text.charCodeAt(end - 2);
    if (high >= 0xd800 && high <= 0xdbff) return end - 2;
  }
  return end - 1;
}

/** End (exclusive) of the inline code span starting at `start`, matching marked's tokenizer; -1 if unpaired. */
export function findCodeSpanEnd(text: string, start: number): number {
  let openerLength = 0;
  while (text[start + openerLength] === "`") openerLength++;
  const contentStart = start + openerLength;
  let i = contentStart;
  while (i < text.length) {
    if (text[i] !== "`") {
      i++;
      continue;
    }
    let closerLength = 0;
    while (text[i + closerLength] === "`") closerLength++;
    const content = text.slice(contentStart, i);
    if (closerLength === openerLength && text[i + closerLength] !== "`" && content[0] !== "`") {
      return i + closerLength;
    }
    i += closerLength;
  }
  return -1;
}

/** Remove unpaired backticks (with their whole run); paired code spans survive untouched. */
export function stripUnpairedBackticks(text: string): string {
  if (!text.includes("`")) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`") {
      const end = findCodeSpanEnd(text, i);
      if (end > i) {
        out += text.slice(i, end);
        i = end;
        continue;
      }
      while (text[i] === "`") i++;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/** Length of the ANSI escape at `pos` (CSI terminated by m/G/K/H/J, OSC/APC by BEL or ST), 0 if none. */
function ansiSequenceLength(text: string, pos: number): number {
  if (pos >= text.length || text.charCodeAt(pos) !== 0x1b) return 0;
  const next = text[pos + 1];
  if (next === "[") {
    for (let j = pos + 2; j < text.length; j++) {
      const c = text.charCodeAt(j);
      if (c === 0x6d || c === 0x47 || c === 0x4b || c === 0x48 || c === 0x4a) return j + 1 - pos;
    }
    return 0;
  }
  if (next === "]" || next === "_") {
    for (let j = pos + 2; j < text.length; j++) {
      if (text.charCodeAt(j) === 0x07) return j + 1 - pos;
      if (text.charCodeAt(j) === 0x1b && text[j + 1] === "\\") return j + 2 - pos;
    }
  }
  return 0;
}

const URL_WORD_RE = /^(?:https?|ftp):\/\//i;
const WWW_WORD_RE = /^www\./i;

/**
 * Escape `@` and unpaired `]` so marked's inline rules leave them (and our ANSI) alone.
 * Also returns how many backslashes were inserted; both come from the same scan so the
 * width budget and the actual output stay consistent. Idempotent.
 */
function scanMarkdownHooks(text: string): { text: string; inserted: number } {
  if (!text.includes("@") && !text.includes("]")) return { text, inserted: 0 };
  let out = "";
  let inserted = 0;
  let i = 0;
  let backslashRun = 0;
  let depth = 0;
  let word = "";
  while (i < text.length) {
    const length = ansiSequenceLength(text, i);
    if (length > 0) {
      out += text.slice(i, i + length);
      i += length;
      continue;
    }
    const ch = text[i];
    if (ch === "`") {
      const end = findCodeSpanEnd(text, i);
      if (end > i) {
        out += text.slice(i, end);
        i = end;
        backslashRun = 0;
        word = "";
        continue;
      }
    }
    word = /\s/.test(ch) ? "" : word + ch;
    if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      if (depth > 0) depth--;
      else if (backslashRun % 2 === 0) {
        out += "\\";
        inserted++;
      }
    } else if (ch === "@") {
      // A word that is already a full bare URL is consumed whole by marked's url rule and
      // would only get dirtied by a backslash. Truncated heads lose the scheme, so the
      // email rule still bites those — they must be escaped.
      const prefix = word.slice(0, -1);
      if (!URL_WORD_RE.test(prefix) && !WWW_WORD_RE.test(prefix) && backslashRun % 2 === 0) {
        out += "\\";
        inserted++;
      }
    }
    out += ch;
    backslashRun = ch === "\\" ? backslashRun + 1 : 0;
    i++;
  }
  return { text: out, inserted };
}

export function escapeMarkdownHooks(text: string): string {
  return scanMarkdownHooks(text).text;
}

/** Visible width plus the columns the hook escaping will add; keeps the width invariant on raw output. */
export function hookAwareWidth(text: string, widthOf: WidthFn): number {
  return widthOf(text) + scanMarkdownHooks(text).inserted;
}

/** Whether a UTF-16 code unit is the low half of a surrogate pair, which must keep its preceding unit. */
function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Start index of the tail window of `text` that fits `maxWidth` columns (dropped head gets an ellipsis elsewhere). */
export function clipToTailIndex(text: string, maxWidth: number, widthOf: WidthFn, ellipsisWidth = 1): number {
  if (maxWidth <= 0) return text.length;
  if (widthOf(text) <= maxWidth) return 0;
  const budget = maxWidth - ellipsisWidth;
  if (budget <= 0) return text.length;
  let used = 0;
  let i = text.length;
  while (i > 0) {
    const start = prevCodePointStart(text, i);
    const width = widthOf(text.slice(start, i));
    if (width > 0 && used + width > budget) break;
    used += width;
    i = start;
  }
  return i;
}

interface Tail {
  /** The newest text that fits one row. */
  text: string;
  /** Whether anything was dropped in front of `text`. */
  dropped: boolean;
}

/** Move a slice start back off the low half of a surrogate pair, which would otherwise lose its code point. */
function backwardStart(text: string, start: number): number {
  return start > 0 && isLowSurrogate(text.charCodeAt(start)) ? start - 1 : start;
}

/**
 * Join only as much of the tail as one row can show, so the work per frame follows the width rather than the
 * block: a thinking block grows one delta at a time and pi redraws the transcript on each of them.
 */
function tailWindow(markdown: string, budget: number, widthOf: WidthFn, ellipsisWidth: number): Tail {
  if (budget - ellipsisWidth <= 0) return { text: "", dropped: true };
  const hookWidth = (text: string): number => hookAwareWidth(text, widthOf);
  const chunk = Math.max(TAIL_MIN_CHARS, budget * TAIL_CHARS_PER_COLUMN);
  let start = backwardStart(markdown, Math.max(0, markdown.length - chunk));
  for (;;) {
    const slice = markdown.slice(start).replace(/\t/g, " ");
    const clean = stripUnpairedBackticks(joinAllLines(slice.split(LINE_BREAK_RE)));
    const from = clipToTailIndex(clean, budget, hookWidth, ellipsisWidth);
    // Nothing was dropped inside the slice: if it does not fill the row either, text before it is still missing
    // (space runs collapse, so a deep slice can hold far less than its length).
    if (from === 0 && start > 0 && hookWidth(clean) < budget) {
      start = backwardStart(markdown, Math.max(0, start - chunk));
      continue;
    }
    return { text: clean.slice(from), dropped: start > 0 || from > 0 };
  }
}

/**
 * Compress a thinking block into one continuously rolling row: `◆ Thinking · …newest words`. The label leads the
 * row while there is room for it, a dropped head leaves a `…`, and only the text is italic.
 * `availableWidth` is the content width pi hands the transformer (padding already removed).
 */
export function buildThinkingWindow(markdown: string, availableWidth: number, widthOf: WidthFn, ansi = true): string {
  if (markdown.trim() === "") return markdown;

  const fullWidth = Math.max(8, Math.floor(availableWidth) || DEFAULT_WIDTH);
  const labelWidth = widthOf(LABEL);
  const ellipsisWidth = widthOf(ELLIPSIS);
  const minLabeledWidth = labelWidth + ellipsisWidth + MIN_CONTENT_WIDTH;
  const width = fullWidth - RIGHT_INSET >= minLabeledWidth ? fullWidth - RIGHT_INSET : fullWidth;
  const useLabel = width >= minLabeledWidth;
  const budget = Math.max(MIN_CONTENT_WIDTH, width - (useLabel ? labelWidth : 0));

  const tail = tailWindow(markdown, budget, widthOf, ellipsisWidth);
  // Head-truncation can cut inside a code span or strand a `]`; judge escaping on the window only.
  const content = escapeMarkdownHooks(stripUnpairedBackticks(tail.text));
  const prefix = tail.dropped && budget - ellipsisWidth > 0 ? ELLIPSIS : "";
  if (!useLabel) return prefix + content;
  return (ansi ? ITALIC_OFF : "") + LABEL + (ansi ? ITALIC_ON : "") + prefix + content;
}
