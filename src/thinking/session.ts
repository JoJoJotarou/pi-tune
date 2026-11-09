import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  MarkdownTransformContext,
  MessageEndEvent,
  MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { groupThinkingBlocks } from "./group.ts";
import { buildThoughtSummary } from "./summary.ts";
import { createThinkingTiming } from "./timing.ts";
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
  ui: Pick<ExtensionContext["ui"], "setHiddenThinkingLabel">;
  sessionManager: Pick<ExtensionContext["sessionManager"], "getEntries">;
}

export interface ThinkingSession {
  start(ctx: ThinkingContext): void;
  messageUpdate(event: MessageUpdateEvent): void;
  messageEnd(event: MessageEndEvent): void;
  /** The registered markdown transformer's body; Pi calls it for every markdown it renders. */
  transformThinking(markdown: string, context: MarkdownTransformContext): string;
}

export function createThinkingSession(host: ThinkingHost): ThinkingSession {
  const timing = createThinkingTiming();
  // context.isStreaming covers the whole message; thinking settles earlier, so track its own
  // boundary. Only thinking_end settles it: some backends (DeepSeek over an OpenAI-compatible
  // stream) send thinking_end after the next block has started, and the run's measured time is
  // still growing until then. A summary shown in between would change under the reader.
  let thinkingStreaming = false;

  // Per-block runs, keyed by contentIndex. The renderer joins consecutive thinking blocks into
  // one markdown, so a duration can only be attached to that joined text once every block of
  // the group has closed — done at message_end (sum), with the whole-response durationMs as
  // the fallback for backends that never time out.
  interface Run {
    text: string;
    startedAt?: number;
    ms?: number;
  }
  const runs = new Map<number, Run>();

  function closeRun(ci: number, now: number, content?: string): void {
    const run = runs.get(ci);
    if (!run) return;
    if (content !== undefined && content.trim() !== "") run.text = content;
    if (run.startedAt === undefined || now < run.startedAt) {
      runs.delete(ci);
      return;
    }
    run.ms = now - run.startedAt;
    timing.seed(run.text, run.ms);
  }

  function closeOpenRuns(now: number): void {
    for (const ci of [...runs.keys()]) {
      if (runs.get(ci)?.ms === undefined) closeRun(ci, now);
    }
  }

  /** Each group's measured time: the sum of its runs, or the whole reply's `durationMs` when a run went unmeasured. */
  function seedGroups(message: AssistantMessage): void {
    for (const group of groupThinkingBlocks(message.content)) {
      const measured = group.indexes.map((index) => runs.get(index)?.ms);
      const ms = measured.every((value) => value !== undefined)
        ? measured.reduce((sum, value) => sum + value, 0)
        : message.durationMs;
      if (ms !== undefined) timing.seed(group.text, ms);
    }
  }

  return {
    start(ctx) {
      timing.reset();
      runs.clear();
      thinkingStreaming = false;
      if (ctx.mode !== "tui") return;
      ctx.ui.setHiddenThinkingLabel("◆ Thinking · click to expand");
      // A resumed session kept no run timings, so its blocks show the whole reply's duration.
      for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== "message" || entry.message.role !== "assistant") continue;
        const { durationMs } = entry.message;
        if (durationMs === undefined) continue;
        for (const group of groupThinkingBlocks(entry.message.content)) timing.seed(group.text, durationMs);
      }
    },
    messageUpdate(event) {
      const update = event.assistantMessageEvent;
      if (!update) return;
      const ci = "contentIndex" in update && typeof update.contentIndex === "number" ? update.contentIndex : 0;
      switch (update.type) {
        case "thinking_start": {
          thinkingStreaming = true;
          runs.set(ci, { text: "", startedAt: host.now() });
          break;
        }
        case "thinking_delta": {
          const run = runs.get(ci);
          if (run && typeof update.delta === "string") run.text += update.delta;
          break;
        }
        case "thinking_end": {
          if (typeof update.content === "string") closeRun(ci, host.now(), update.content);
          thinkingStreaming = false;
          break;
        }
        case "text_start":
        case "text_delta":
        case "toolcall_start":
        case "toolcall_delta": {
          // Close the run for the backends that never send thinking_end, but keep showing the
          // window: until thinking_end the measured time is not final.
          closeOpenRuns(host.now());
          break;
        }
      }
    },
    messageEnd(event) {
      if (event.message.role === "assistant") seedGroups(event.message);
      runs.clear();
      thinkingStreaming = false;
    },
    transformThinking(markdown, context) {
      if (context.messageType !== "assistant-thinking") return markdown;
      if (markdown.trim() === "") return markdown;

      if (!thinkingStreaming) {
        const durationMs = timing.durationFor(markdown);
        if (durationMs !== undefined)
          return buildThoughtSummary(markdown, durationMs, context.availableWidth, visibleWidth);
      }
      // No measured duration: keep the rolling window as the residue rather than inventing a summary.
      return buildThinkingWindow(markdown, context.availableWidth, visibleWidth, host.colorEnabled());
    },
  };
}
