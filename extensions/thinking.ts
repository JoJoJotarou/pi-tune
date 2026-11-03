import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildThoughtSummary } from "../src/thinking/summary.ts";
import { createThinkingTiming } from "../src/thinking/timing.ts";
import { buildThinkingWindow } from "../src/thinking/window.ts";

interface ThinkingBlockLike {
  type?: string;
  thinking?: string;
}

interface AssistantMessageLike {
  role: string;
  durationMs?: number;
  content?: ThinkingBlockLike[];
}

/** Rows shown for an expanded thinking block: the head row plus the newest content rows. */
const WINDOW_LINES = 4;

export default (pi: ExtensionAPI) => {
  const timing = createThinkingTiming();
  // context.isStreaming covers the whole message; thinking settles earlier, so track its own
  // boundary. Events after thinking_end close the run for backends that never send thinking_end.
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

  function seedJoinedGroups(message: AssistantMessageLike): void {
    const fallback = typeof message.durationMs === "number" && message.durationMs >= 0 ? message.durationMs : undefined;
    let group: Run[] = [];
    const flush = (): void => {
      if (group.length === 0) return;
      const joined = group.map((run) => run.text).join("\n\n");
      if (joined.trim() !== "") {
        const total = group.reduce((sum, run) => sum + (run.ms ?? 0), 0);
        if (group.every((run) => run.ms !== undefined)) timing.seed(joined, total);
        else if (fallback !== undefined) timing.seed(joined, fallback);
      }
      group = [];
    };
    for (const block of message.content ?? []) {
      if (block?.type !== "thinking") {
        flush();
        continue;
      }
      const text = typeof block.thinking === "string" ? block.thinking.trim() : "";
      if (text !== "") group.push({ text, ms: undefined });
    }
    flush();
  }

  pi.on("session_start", (_event, ctx) => {
    timing.reset();
    runs.clear();
    thinkingStreaming = false;
    if (ctx.mode !== "tui") return;
    ctx.ui.setHiddenThinkingLabel("◆ Thinking · click to expand");
    hydrateDurations(ctx.sessionManager.getEntries(), (markdown, ms) => timing.seed(markdown, ms));
  });

  pi.on("message_update", (event) => {
    const update = event.assistantMessageEvent;
    if (!update) return;
    const ci = "contentIndex" in update && typeof update.contentIndex === "number" ? update.contentIndex : 0;
    switch (update.type) {
      case "thinking_start": {
        thinkingStreaming = true;
        runs.set(ci, { text: "", startedAt: Date.now() });
        break;
      }
      case "thinking_delta": {
        const run = runs.get(ci);
        if (run && typeof update.delta === "string") run.text += update.delta;
        break;
      }
      case "thinking_end": {
        if (typeof update.content === "string") closeRun(ci, Date.now(), update.content);
        thinkingStreaming = false;
        break;
      }
      case "text_start":
      case "text_delta":
      case "toolcall_start":
      case "toolcall_delta": {
        closeOpenRuns(Date.now());
        thinkingStreaming = false;
        break;
      }
    }
  });

  pi.on("message_end", (event) => {
    const message = event.message.role === "assistant" ? event.message : undefined;
    if (message) seedJoinedGroups(message as AssistantMessageLike);
    runs.clear();
    thinkingStreaming = false;
  });

  pi.registerMarkdownTransformer((markdown, context) => {
    if (context.messageType !== "assistant-thinking") return markdown;
    if (markdown.trim() === "") return markdown;

    const ansi = process.env.TERM !== "dumb" && !process.env.NO_COLOR;
    if (!thinkingStreaming) {
      const durationMs = timing.durationFor(markdown);
      if (durationMs !== undefined) {
        const head = buildThoughtSummary(markdown, durationMs, context.availableWidth, visibleWidth);
        return buildThinkingWindow(markdown, context.availableWidth, visibleWidth, ansi, WINDOW_LINES, head);
      }
    }
    // No measured duration: keep the rolling window as the residue rather than invent a summary.
    return buildThinkingWindow(markdown, context.availableWidth, visibleWidth, ansi, WINDOW_LINES);
  });
};

/** Duration table for historical blocks after a session resume: whole-response durationMs per thinking run. */
function hydrateDurations(entries: readonly unknown[], seed: (markdown: string, ms: number) => void): void {
  for (const entry of entries) {
    const message = (entry as { type?: string; message?: AssistantMessageLike }).message;
    if (message?.role !== "assistant") continue;
    const durationMs = message.durationMs;
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) continue;
    // The renderer joins consecutive thinking blocks into one markdown, so key the same way.
    let group: string[] = [];
    const flush = (): void => {
      if (group.length > 0) {
        seed(group.join("\n\n"), durationMs);
        group = [];
      }
    };
    for (const block of message.content ?? []) {
      if (block?.type !== "thinking") {
        flush();
        continue;
      }
      const text = typeof block.thinking === "string" ? block.thinking.trim() : "";
      if (text !== "") group.push(text);
    }
    flush();
  }
}
