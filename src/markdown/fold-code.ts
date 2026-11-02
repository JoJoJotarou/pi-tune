import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Token, Tokens } from "marked";
import { Lexer } from "marked";

const MAX_LINES = 20;
const KEEP_LINES = 12;

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Span {
  start: number;
  end: number;
}

interface Child {
  tokens: Token[];
  source: string;
  base: number;
}

type CodeVisitor = (code: Tokens.Code, span: Span) => void;

const SKIP = new Set(["codespan", "html"]);
const FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const CLOSING = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find `raw` in `source` from `from`. Children of list items are lexed without their container
 * indent, so a uniform extra indent on every line is accepted as well.
 */
function locate(source: string, raw: string, from: number): Span | undefined {
  const direct = source.indexOf(raw, from);
  if (direct !== -1) return { start: direct, end: direct + raw.length };
  const lines = raw.split("\n");
  if (lines[0] === "") return undefined;
  const pattern = new RegExp(`^([ \\t]*)${escapeRegExp(lines[0])}`, "gm");
  pattern.lastIndex = from;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const indent = match[1];
    let cursor = match.index;
    let ok = true;
    for (const [index, line] of lines.entries()) {
      if (index > 0) {
        if (source[cursor] !== "\n") {
          ok = false;
          break;
        }
        cursor += 1;
      }
      if (line === "") continue;
      const expected = indent + line;
      if (source.slice(cursor, cursor + expected.length) !== expected) {
        ok = false;
        break;
      }
      cursor += expected.length;
    }
    if (ok) return { start: match.index, end: cursor };
    pattern.lastIndex = match.index + match[0].length;
  }
  return undefined;
}

function childrenOf(token: Token, start: number): Child[] {
  if (token.type === "list") {
    return [{ tokens: (token as Tokens.List).items, source: token.raw, base: start }];
  }
  const nested = (token as { tokens?: Token[] }).tokens;
  return nested ? [{ tokens: nested, source: token.raw, base: start }] : [];
}

/** Walk block tokens in document order, reporting each fenced or indented code block with its span. */
function eachCode(tokens: Token[], source: string, base: number, visit: CodeVisitor): void {
  let cursor = 0;
  for (const token of tokens) {
    const span = locate(source, token.raw, cursor);
    if (!span) continue;
    cursor = span.end;
    const start = base + span.start;
    if (token.type === "code") {
      visit(token as Tokens.Code, { start, end: base + span.end });
      continue;
    }
    if (SKIP.has(token.type)) continue;
    for (const child of childrenOf(token, start)) eachCode(child.tokens, child.source, child.base, visit);
  }
}

function applyEdits(source: string, edits: readonly Edit[]): string {
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

function foldBlock(block: string, theme: Theme): string | undefined {
  const lines = block.split("\n");
  const trailing = lines[lines.length - 1] === "";
  const end = trailing ? lines.length - 1 : lines.length;
  const open = FENCE.exec(lines[0] ?? "");
  if (!open) return undefined;
  const indent = open[1];
  const marker = open[2];
  const closed = end > 1 && CLOSING.exec(lines[end - 1] ?? "");
  const body = lines.slice(1, closed ? end - 1 : end);
  if (body.length <= MAX_LINES) return undefined;
  const closing = closed ? lines[end - 1] : indent + marker;
  const removed = body.length - KEEP_LINES;
  const folded = [
    lines[0],
    ...body.slice(0, KEEP_LINES),
    closing,
    indent + theme.fg("dim", `┄ ${removed} more lines · alt+o to view`),
  ];
  return folded.join("\n") + (trailing ? "\n" : "");
}

export function foldLongCode(markdown: string, theme: Theme): string {
  const edits: Edit[] = [];
  eachCode(Lexer.lex(markdown), markdown, 0, (code, span) => {
    if (code.codeBlockStyle === "indented") return;
    if ((code.lang ?? "").trim().toLowerCase().startsWith("mermaid")) return;
    const text = foldBlock(markdown.slice(span.start, span.end), theme);
    if (text !== undefined) edits.push({ ...span, text });
  });
  return applyEdits(markdown, edits);
}
