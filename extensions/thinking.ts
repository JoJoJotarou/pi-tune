import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildThoughtSummary } from "../src/thinking/summary.ts";
import { createThinkingTiming } from "../src/thinking/timing.ts";
import { buildThinkingWindow } from "../src/thinking/window.ts";

interface AssistantMessageLike {
  role: string;
  durationMs?: number;
  content?: Array<{ type?: string; thinking?: string }>;
}

/** Duration table for historical blocks after a session resume: whole-response durationMs per thinking run. */
function hydrateDurations(entries: readonly unknown[], seed: (markdown: string, ms: number) => void): void {
  for (const entry of entries) {
    const message = (entry as { type?: string; message?: AssistantMessageLike }).message;
    if (message?.role !== "assistant") continue;
    const durationMs = message.durationMs;
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) continue;
    // The renderer joins consecutive thinking blocks into one markdown, so key the same way.
    const group: string[] = [];
    for (const block of message.content ?? []) {
      if (block?.type !== "thinking") continue;
      const text = typeof block.thinking === "string" ? block.thinking.trim() : "";
      if (text !== "") group.push(text);
      else if (group.length > 0) {
        seed(group.join("\n\n"), durationMs);
        group.length = 0;
      }
    }
    if (group.length > 0) seed(group.join("\n\n"), durationMs);
  }
}

export default (pi: ExtensionAPI) => {
  const timing = createThinkingTiming();
  // context.isStreaming covers the whole message; thinking settles earlier, so track its own
  // boundary. Events after thinking_end close the run for backends that never send thinking_end.
  let thinkingStreaming = false;

  pi.on("session_start", (_event, ctx) => {
    timing.reset();
    thinkingStreaming = false;
    if (ctx.mode !== "tui") return;
    ctx.ui.setHiddenThinkingLabel("◆ Thinking · click to expand");
    hydrateDurations(ctx.sessionManager.getEntries(), (markdown, ms) => timing.seed(markdown, ms));
  });

  pi.on("message_update", (event) => {
    const update = event.assistantMessageEvent;
    if (!update) return;
    switch (update.type) {
      case "thinking_start":
        timing.start(Date.now());
        thinkingStreaming = true;
        break;
      case "thinking_end":
        if (typeof update.content === "string") timing.finish(update.content, Date.now());
        thinkingStreaming = false;
        break;
      case "text_start":
      case "text_delta":
      case "toolcall_start":
      case "toolcall_delta":
        thinkingStreaming = false;
        break;
    }
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== "assistant-thinking") return markdown;
    if (markdown.trim() === "") return markdown;

    const ansi = process.env.TERM !== "dumb" && !process.env.NO_COLOR;
    if (!thinkingStreaming) {
      const durationMs = timing.durationFor(markdown);
      if (durationMs !== undefined) {
        return buildThoughtSummary(markdown, durationMs, context.availableWidth, visibleWidth);
      }
    }
    // No measured duration: keep the rolling window as the residue rather than invent a summary.
    return buildThinkingWindow(markdown, context.availableWidth, visibleWidth, ansi);
  });
};
