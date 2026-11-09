import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AssistantMessageComponent,
  ExtensionContext,
  MarkdownTransformContext,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import {
  assistantMessages,
  type DrawnMessage,
  drawnMessage,
  newestAssistantMessage,
} from "../internals/transcript-components.ts";
import { buildThoughtLabel } from "./label.ts";
import { buildThinkingWindow } from "./window.ts";

/** Custom session entry holding a measured thinking time, so a reload or a resumed session can restore it. */
const TIMING_ENTRY = "pi-tune-thinking";

/** What the thinking session reads from the running Pi instance; injected so tests can fake it. */
export interface ThinkingHost {
  now(): number;
  /** Whether ANSI styling is on: `TERM !== "dumb" && !NO_COLOR` in the extension. */
  colorEnabled(): boolean;
  /** Pi's `pi.appendEntry`: durable session data that never reaches the model. */
  appendEntry(customType: string, data: unknown): void;
}

/** The part of Pi's `ExtensionContext` the thinking session uses. */
export interface ThinkingContext {
  mode: ExtensionContext["mode"];
  ui: Pick<ExtensionContext["ui"], "setHiddenThinkingLabel" | "setWidget" | "notify">;
  sessionManager: Pick<ExtensionContext["sessionManager"], "getEntries">;
}

export interface ThinkingSession {
  start(ctx: ThinkingContext): void;
  /** Pi started a message; an assistant one is the run the transcript is streaming into. */
  messageStart(event: MessageStartEvent): void;
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
  /** The drawn transcript is folded once per session, on the first frame that pc draws the widget. */
  let historyFolded = false;
  /** Whether the message being streamed held a thinking block, which is what a recorded time belongs to. */
  let messageHadThinking = false;
  /** Whether a run is streaming: the drawn transcript is left alone while it is, so no block folds mid-run. */
  let runActive = false;
  /** Measured time by message timestamp, hydrated from the session so a rebuilt transcript keeps its labels. */
  const recordedTimes = new Map<number, number>();
  /** Set once a message timestamp no longer reads: the labels lose their times, the fold keeps working. */
  let timesUnavailable = false;

  function fold(message: AssistantMessageComponent, label: string): void {
    // No repaint request: pi draws a frame after every event, and a forced full redraw here would re-render the
    // whole transcript on each message end.
    message.setHideThinkingBlock(true);
    message.setHiddenThinkingLabel(label);
    message.invalidate();
  }

  function reportFailure(error: Error): void {
    foldFailed = true;
    notify?.(`pi-tune thinking fold disabled: ${error.message}`, "warning");
  }

  /** Fold the newest assistant message to `◆ Thought for …`; the block's own text is handed back by the transformer. */
  function foldSettledThinking(): void {
    const screen = tui;
    if (!screen || foldFailed) return;
    const message = newestAssistantMessage(screen);
    if (message === undefined) return;
    if (message instanceof Error) {
      reportFailure(message);
      return;
    }
    fold(message, buildThoughtLabel(messageThinkingMs));
  }

  /** The recorded time a drawn message carries, if the session still has one for it. */
  function recordedLabel(drawn: DrawnMessage): string {
    if (timesUnavailable) return buildThoughtLabel(undefined);
    return buildThoughtLabel(recordedTimes.get(drawn.timestamp));
  }

  /**
   * Fold the transcript already drawn: a reload, and a resumed session, rebuild every block from the setting, and the
   * block of a measured run carries that time in the session. Called from the widget's render, because pi draws the
   * widget before the rebuilt messages exist: the first frame that has them is the earliest chance to fold.
   */
  function foldDrawnMessages(): void {
    const screen = tui;
    if (!screen || foldFailed || historyFolded || runActive) return;
    const messages = assistantMessages(screen);
    if (messages instanceof Error) {
      reportFailure(messages);
      return;
    }
    let folded = 0;
    for (const message of messages) {
      const drawn = drawnMessage(message);
      if (drawn === undefined) continue;
      if (drawn instanceof Error) {
        if (timesUnavailable) continue;
        timesUnavailable = true;
        notify?.(`pi-tune thinking time unavailable: ${drawn.message}`, "warning");
        continue;
      }
      if (drawn.pending) continue;
      fold(message, recordedLabel(drawn));
      folded++;
    }
    if (folded === 0) return;
    historyFolded = true;
    // The fold changed rows this frame may already have drawn, so ask for one more frame.
    screen.requestRender();
  }

  /** Keep the measured time in the session: a reload and a resumed session have no run to time again. */
  function recordThinkingTime(message: AssistantMessage): void {
    if (!messageHadThinking || messageThinkingMs === undefined) return;
    recordedTimes.set(message.timestamp, messageThinkingMs);
    host.appendEntry(TIMING_ENTRY, { timestamp: message.timestamp, ms: messageThinkingMs });
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
      historyFolded = false;
      messageHadThinking = false;
      runActive = false;
      recordedTimes.clear();
      timesUnavailable = false;
      notify = undefined;
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== "custom" || entry.customType !== TIMING_ENTRY) continue;
        const data = entry.data as { timestamp?: unknown; ms?: unknown } | undefined;
        if (typeof data?.timestamp !== "number" || typeof data.ms !== "number") continue;
        recordedTimes.set(data.timestamp, data.ms);
      }
      if (ctx.mode !== "tui") return;
      notify = (message, level) => ctx.ui.notify(message, level);
      // Blocks already in the transcript cannot be measured any more, so they keep this label.
      ctx.ui.setHiddenThinkingLabel("◆ Thinking · click to expand");
      // The widget factory is the only place an extension is handed the TUI.
      ctx.ui.setWidget("pi-tune-thinking", (widgetTui) => {
        tui = widgetTui;
        return {
          render: () => {
            foldDrawnMessages();
            return [];
          },
          invalidate() {},
        };
      });
    },
    messageStart(event) {
      runActive = event.message.role === "assistant";
    },
    messageUpdate(event) {
      const update = event.assistantMessageEvent;
      if (!update) return;
      switch (update.type) {
        case "thinking_start": {
          thinkingStreaming = true;
          messageHadThinking = true;
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
        recordThinkingTime(event.message);
      }
      runs.clear();
      thinkingStreaming = false;
      messageThinkingMs = 0;
      messageHadThinking = false;
      runActive = false;
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
