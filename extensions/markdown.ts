import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { appendLinkDomains, rewriteHeadings, tablesToLists } from "../src/markdown/rewrite.ts";

export default function markdownExtension(pi: ExtensionAPI): void {
  let theme: Theme | undefined;

  pi.on("session_start", (_event, ctx) => {
    theme = ctx.ui.theme;
  });

  pi.registerMarkdownTransformer((markdown, { messageType, isStreaming, availableWidth }) => {
    if (messageType !== "assistant") return markdown;
    let out = rewriteHeadings(markdown);
    if (theme) out = appendLinkDomains(out, theme);
    if (!isStreaming) out = tablesToLists(out, availableWidth);
    return out;
  });
}
