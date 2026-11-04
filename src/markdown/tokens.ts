import { Marked, type Token, type Tokens } from "@earendil-works/pi-tui";

export interface Edit {
  start: number;
  end: number;
  text: string;
}

export interface Span {
  start: number;
  end: number;
}

export type Visitor = (token: Token, start: number, end: number) => boolean | undefined;

const marked = new Marked();

export function lex(markdown: string): Token[] {
  return marked.lexer(markdown);
}

function matchLines(source: string, lines: string[], start: number, prefix: string): Span | undefined {
  let cursor = start;
  for (const [index, line] of lines.entries()) {
    if (index > 0) {
      if (source[cursor] !== "\n") return undefined;
      cursor += 1;
    }
    const text = index === 0 ? line.trimStart() : line;
    if (text !== "") {
      if (index > 0) {
        if (!source.startsWith(prefix, cursor)) return undefined;
        cursor += prefix.length;
      }
      if (!source.startsWith(text, cursor)) return undefined;
      cursor += text.length;
    }
    const eol = source.indexOf("\n", cursor);
    const rest = source.slice(cursor, eol === -1 ? source.length : eol);
    if (rest.trim() !== "") return undefined;
    cursor += rest.length;
  }
  return { start, end: source[cursor] === "\n" ? cursor + 1 : cursor };
}

/**
 * Find `raw` in `source` from `from`. Children of list items are lexed without their container
 * indent, so a uniform extra indent on every line is accepted as well. The first line may also sit
 * mid-line, after a list marker.
 */
function locate(source: string, raw: string, from: number): Span | undefined {
  const direct = source.indexOf(raw, from);
  if (direct !== -1) return { start: direct, end: direct + raw.length };
  const lines = raw.split("\n");
  const wanted = lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  const first = wanted[0]?.trimStart();
  if (!first) return undefined;
  for (const anchored of [true, false]) {
    for (let index = source.indexOf(first, from); index !== -1; index = source.indexOf(first, index + 1)) {
      const lineStart = source.lastIndexOf("\n", index - 1) + 1;
      const indent = source.slice(lineStart, index);
      if ((indent.trim() === "") !== anchored) continue;
      const prefix = anchored ? indent : " ".repeat(index - lineStart);
      const span = matchLines(source, wanted, index, prefix);
      if (span) return anchored ? { start: lineStart, end: span.end } : span;
    }
  }
  return undefined;
}

function childrenOf(token: Token): Token[] {
  if (token.type === "list") return token.items;
  if (token.type === "table") {
    return [...token.header, ...token.rows.flat()].flatMap((cell) => cell.tokens);
  }
  return (token as { tokens?: Token[] }).tokens ?? [];
}

/** Walk tokens in document order, giving each one its absolute span in `source`. */
export function walk(tokens: Token[], source: string, from: number, visit: Visitor): void {
  let cursor = from;
  for (const token of tokens) {
    const span = locate(source, token.raw, cursor);
    if (!span) continue;
    cursor = span.end;
    if (visit(token, span.start, span.end)) continue;
    walk(childrenOf(token), source, span.start, visit);
  }
}

/**
 * Build the edit that replaces a blockquote with its transformed inner text. A blockquote's children are
 * lexed from `token.text`, which has the `> ` prefixes removed, so transforms must run on that text and
 * the prefix must go back on every line they emit. Nested quotes recurse through the same helper because
 * the inner text still carries them.
 */
export function transformBlockquote(
  token: Token,
  markdown: string,
  start: number,
  end: number,
  transform: (markdown: string) => string,
): Edit | undefined {
  if (token.type !== "blockquote") return undefined;
  const raw = markdown.slice(start, end);
  const marker = /^[ \t]*>/.exec(raw)?.[0];
  if (marker === undefined) return undefined;
  const inner = transform((token as Tokens.Blockquote).text).replace(/\n+$/, "");
  const lines = inner.split("\n").map((line) => (line === "" ? marker : `${marker} ${line}`));
  return { start, end, text: lines.join("\n") + (raw.endsWith("\n") ? "\n" : "") };
}

export function applyEdits(source: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = "";
  let cursor = 0;
  for (const edit of ordered) {
    if (edit.start < cursor) continue;
    out += source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + source.slice(cursor);
}
