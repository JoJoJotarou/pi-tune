import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Tokens } from "@earendil-works/pi-tui";
import { applyEdits, type Edit, lex, transformBlockquote, walk } from "../src/markdown/tokens.ts";
import { previewFile } from "../src/mermaid/preview-file.ts";
import { mermaidMarkdown } from "../src/mermaid/render.ts";

const NOTICE = 'pi-tune: set "markdown": { "mermaid": "off" } in Pi settings for diagram previews and source copy';

const MERMAID_FENCE = /^[ \t]*```[ \t]*mermaid\b/m;

/** Replace every Mermaid fence with the art and action row, leaving unsupported sources as code. */
export function replaceMermaidFences(markdown: string, availableWidth: number, theme: Theme): string {
  const edits: Edit[] = [];
  walk(lex(markdown), markdown, 0, (token, start, end) => {
    if (token.type === "blockquote") {
      const edit = transformBlockquote(token, markdown, start, end, (inner) =>
        replaceMermaidFences(inner, availableWidth, theme),
      );
      if (edit) edits.push(edit);
      return true;
    }
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
