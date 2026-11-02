import type { ExtensionAPI, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { keyText } from "@earendil-works/pi-coding-agent";
import { type KeyId, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { foldThinking } from "../src/thinking/fold.ts";
import { createThinkingTiming } from "../src/thinking/timing.ts";

export default (pi: ExtensionAPI) => {
  const timing = createThinkingTiming();
  let ui: ExtensionUIContext | undefined;
  let tui: TUI | undefined;
  let unsubscribeInput: (() => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    ui = ctx.ui;
    timing.reset();
    if (ctx.mode !== "tui") return;

    ctx.ui.setWidget("pi-tune-thinking", (widgetTui) => {
      tui = widgetTui;
      return { render: () => [], invalidate() {} };
    });

    unsubscribeInput?.();
    unsubscribeInput = ctx.ui.onTerminalInput((data) => {
      // keyText returns the display text of the current binding, which is a valid KeyId.
      if (!matchesKey(data, keyText("app.tools.expand") as KeyId)) return;
      setTimeout(() => {
        tui?.invalidate();
        tui?.requestRender();
      }, 0);
    });
  });

  pi.on("session_shutdown", () => {
    unsubscribeInput?.();
    unsubscribeInput = undefined;
    tui = undefined;
  });

  pi.on("message_update", (event) => {
    const update = event.assistantMessageEvent;
    if (update.type === "thinking_start") timing.start(Date.now());
    else if (update.type === "thinking_end") timing.finish(update.content, Date.now());
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== "assistant-thinking") return markdown;
    if (ui?.getToolsExpanded()) return markdown;

    if (context.isStreaming) {
      const started = timing.startedAt();
      return foldThinking(markdown, {
        isStreaming: true,
        elapsedMs: started === undefined ? undefined : Date.now() - started,
      });
    }
    return foldThinking(markdown, { isStreaming: false, durationMs: timing.durationFor(markdown) });
  });
};
