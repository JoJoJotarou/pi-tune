import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Marked, type Token, type Tokens } from "@earendil-works/pi-tui";
import { previewFile } from "../src/mermaid/preview-file.ts";
import { mermaidMarkdown } from "../src/mermaid/render.ts";

const marked = new Marked();

const NOTICE = 'pi-tune: set "markdown": { "mermaid": "off" } in Pi settings for diagram previews and source copy';

const MERMAID_FENCE = /^[ \t]*```[ \t]*mermaid\b/m;

interface Edit {
  start: number;
  end: number;
  text: string;
}

interface Child {
  tokens: readonly Token[];
  source: string;
  base: number;
}

type Visitor = (token: Token, start: number, end: number) => boolean | undefined;

function childrenOf(token: Token, start: number): Child[] {
  if (token.type === "list") {
    return [{ tokens: (token as Tokens.List).items, source: token.raw, base: start }];
  }
  const nested = (token as { tokens?: Token[] }).tokens;
  return nested ? [{ tokens: nested, source: token.raw, base: start }] : [];
}

function walk(tokens: readonly Token[], source: string, base: number, visit: Visitor): void {
  let cursor = 0;
  for (const token of tokens) {
    const index = source.indexOf(token.raw, cursor);
    const offset = index === -1 ? cursor : index;
    cursor = offset + token.raw.length;
    const start = base + offset;
    if (visit(token, start, start + token.raw.length)) continue;
    for (const child of childrenOf(token, start)) walk(child.tokens, child.source, child.base, visit);
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

/** Replace every Mermaid fence with the art and action row, leaving unsupported sources as code. */
export function replaceMermaidFences(markdown: string, availableWidth: number, theme: Theme): string {
  const edits: Edit[] = [];
  walk(marked.lexer(markdown), markdown, 0, (token, start, end) => {
    if (token.type !== "code") return;
    const code = token as Tokens.Code;
    if (code.lang?.toLowerCase() !== "mermaid") return;
    const replacement = mermaidMarkdown(code.text, availableWidth, theme, previewFile(code.text));
    if (replacement !== undefined) edits.push({ start, end, text: replacement });
    return true;
  });
  return applyEdits(markdown, edits);
}

export default function mermaidExtension(pi: ExtensionAPI): void {
  let theme: Theme | undefined;
  let registered = false;
  let warned = false;

  pi.on("session_start", (_event, ctx) => {
    theme = ctx.ui.theme;
    warned = false;
    if (pi.getSettings().markdown?.mermaid !== "off") return;
    if (registered) return;
    registered = true;
    pi.registerMarkdownTransformer((markdown, { messageType, isStreaming, availableWidth }) => {
      if (messageType !== "assistant" || isStreaming || !theme) return markdown;
      return replaceMermaidFences(markdown, availableWidth, theme);
    });
  });

  pi.on("message_end", (event, ctx) => {
    if (warned || pi.getSettings().markdown?.mermaid === "off") return;
    const { message } = event;
    if (message.role !== "assistant") return;
    const text = message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
    if (!MERMAID_FENCE.test(text)) return;
    warned = true;
    ctx.ui.notify(NOTICE, "info");
  });
}
