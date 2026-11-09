import type {
  ExtensionContext,
  MarkdownTransformContext,
  MessageEndEvent,
  MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { newestAssistantMessage } from "../internals/transcript-components.ts";
import { buildThoughtLabel } from "./label.ts";
import { buildThinkingWindow } from "./window.ts";

/** What the thinking session reads from the running Pi instance; injected so tests can fake it. */
export interface ThinkingHost {
  now(): number;
  /** Whether ANSI styling is on: `TERM !== "dumb" && !NO_COLOR` in the extension. */
  colorEnabled(): boolean;
}

/** The part of Pi's `ExtensionContext` the thinking session uses. */
export interface ThinkingContext {
  mode: ExtensionContext["mode"];
  ui: Pick<ExtensionContext["ui"], "setHiddenThinkingLabel" | "setWidget" | "notify">;
}

export interface ThinkingSession {
  start(ctx: ThinkingContext): void;
  messageUpdate(event: MessageUpdateEvent): void;
  messageEnd(event: MessageEndEvent): void;
  /** The registered markdown transformer's body; Pi calls it for every markdown it renders. */
  transformThinking(markdown: string, context: MarkdownTransformContext): string;
}

export function createThinkingSession(host: ThinkingHost): ThinkingSession {
  // While a block streams, its text rolls in one row. Once it settles this session folds it and the transformer
  // hands pi's markdown back, so opening the block shows the text exactly as the model wrote it.
  let thinkingStreaming = false;
  /** Start time of the thinking blocks still streaming, by contentIndex. */
  const runs = new Map<number, number>();
  /** Thinking time of the message being streamed; `undefined` once any of its blocks went unmeasured. */
  let messageThinkingMs: number | undefined = 0;
  let tui: TUI | undefined;
  let notify: ((message: string, level: "warning") => void) | undefined;
  /** Set once the transcript shape moved: the fold stops rather than guesses, and the block stays as Pi drew it. */
  let foldFailed = false;

  /** Fold the newest assistant message to `◆ Thought for …`; the block's own text is handed back by the transformer. */
  function foldSettledThinking(): void {
    const screen = tui;
    if (!screen || foldFailed) return;
    const message = newestAssistantMessage(screen);
    if (message === undefined) return;
    if (message instanceof Error) {
      foldFailed = true;
      notify?.(`pi-tune thinking fold disabled: ${message.message}`, "warning");
      return;
    }
    message.setHideThinkingBlock(true);
    message.setHiddenThinkingLabel(buildThoughtLabel(messageThinkingMs));
    // No repaint request: pi draws a frame after every event, and a forced full redraw here re-renders the whole
    // transcript on each message end.
    message.invalidate();
  }

  /** Close one run and add it to the message total; a clock that went backwards leaves the total unmeasured. */
  function settleRun(ci: number, now: number): void {
    const startedAt = runs.get(ci);
    if (startedAt === undefined) return;
    runs.delete(ci);
    const ms = now < startedAt ? undefined : now - startedAt;
    messageThinkingMs = messageThinkingMs === undefined || ms === undefined ? undefined : messageThinkingMs + ms;
  }

  function contentIndexOf(update: MessageUpdateEvent["assistantMessageEvent"]): number {
    return update && "contentIndex" in update && typeof update.contentIndex === "number" ? update.contentIndex : 0;
  }

  return {
    start(ctx) {
      runs.clear();
      thinkingStreaming = false;
      messageThinkingMs = 0;
      tui = undefined;
      foldFailed = false;
      notify = undefined;
      if (ctx.mode !== "tui") return;
      notify = (message, level) => ctx.ui.notify(message, level);
      // Blocks already in the transcript cannot be measured any more, so they keep this label.
      ctx.ui.setHiddenThinkingLabel("◆ Thinking · click to expand");
      // The widget factory is the only place an extension is handed the TUI.
      ctx.ui.setWidget("pi-tune-thinking", (widgetTui) => {
        tui = widgetTui;
        return { render: () => [], invalidate() {} };
      });
    },
    messageUpdate(event) {
      const update = event.assistantMessageEvent;
      if (!update) return;
      switch (update.type) {
        case "thinking_start": {
          thinkingStreaming = true;
          runs.set(contentIndexOf(update), host.now());
          break;
        }
        case "thinking_end": {
          // Only thinking_end settles a run: DeepSeek over an OpenAI-compatible stream sends it after the next
          // block has started, and the measured time is still growing until then.
          settleRun(contentIndexOf(update), host.now());
          thinkingStreaming = runs.size > 0;
          foldSettledThinking();
          break;
        }
      }
    },
    messageEnd(event) {
      if (event.message.role === "assistant") {
        // A run still open never ended: a backend that sends no thinking_end gives no measured end to claim.
        if (runs.size > 0) messageThinkingMs = undefined;
        runs.clear();
        foldSettledThinking();
      }
      runs.clear();
      thinkingStreaming = false;
      messageThinkingMs = 0;
    },
    transformThinking(markdown, context) {
      if (context.messageType !== "assistant-thinking") return markdown;
      if (markdown.trim() === "") return markdown;
      // A settled block is folded by this session; an opened one shows pi's own markdown untouched.
      if (!thinkingStreaming) return markdown;
      return buildThinkingWindow(markdown, context.availableWidth, visibleWidth, host.colorEnabled());
    },
  };
}
