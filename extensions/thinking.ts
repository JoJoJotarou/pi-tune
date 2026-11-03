import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { thinkingHeader } from "../src/thinking/header.ts";
import { createThinkingTiming } from "../src/thinking/timing.ts";

export default (pi: ExtensionAPI) => {
  const timing = createThinkingTiming();

  pi.on("session_start", (_event, ctx) => {
    timing.reset();
    if (ctx.mode !== "tui") return;
    ctx.ui.setHiddenThinkingLabel("◆ Thinking · click to expand");
  });

  pi.on("message_update", (event) => {
    const update = event.assistantMessageEvent;
    if (update.type === "thinking_start") timing.start(Date.now());
    else if (update.type === "thinking_end") timing.finish(update.content, Date.now());
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== "assistant-thinking") return markdown;

    if (context.isStreaming) {
      const started = timing.startedAt();
      return thinkingHeader(markdown, {
        isStreaming: true,
        elapsedMs: started === undefined ? undefined : Date.now() - started,
      });
    }
    return thinkingHeader(markdown, { isStreaming: false, durationMs: timing.durationFor(markdown) });
  });
};
