import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Tokens } from "@earendil-works/pi-tui";
import { applyEdits, type Edit, lex, transformBlockquote, walk } from "./tokens.ts";

const MAX_LINES = 20;
const KEEP_LINES = 12;

const FENCE = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
const CLOSING = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

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
  walk(lex(markdown), markdown, 0, (token, start, end) => {
    if (token.type === "blockquote") {
      const edit = transformBlockquote(token, markdown, start, end, (inner) => foldLongCode(inner, theme));
      if (edit) edits.push(edit);
      return true;
    }
    if (token.type !== "code") return;
    const code = token as Tokens.Code;
    if (code.codeBlockStyle === "indented") return true;
    if ((code.lang ?? "").trim().toLowerCase().startsWith("mermaid")) return true;
    const text = foldBlock(markdown.slice(start, end), theme);
    if (text !== undefined) edits.push({ start, end, text });
    return true;
  });
  return applyEdits(markdown, edits);
}
