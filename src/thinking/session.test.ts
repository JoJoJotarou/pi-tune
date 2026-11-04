import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  MarkdownTransformContext,
  MessageEndEvent,
  MessageUpdateEvent,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { createThinkingSession, type ThinkingContext, type ThinkingHost, type ThinkingSession } from "./session.ts";

interface Harness {
  session: ThinkingSession;
  ctx: ThinkingContext;
  labels: string[];
  entries: SessionEntry[];
  now(ms: number): void;
}

function harness(): Harness {
  const labels: string[] = [];
  const entries: SessionEntry[] = [];
  let nowMs = 1_000;
  const ctx: ThinkingContext = {
    mode: "tui",
    ui: { setHiddenThinkingLabel: (label) => labels.push(label) },
    sessionManager: { getEntries: () => entries },
  };
  const host: ThinkingHost = { now: () => nowMs, colorEnabled: () => false };
  return {
    session: createThinkingSession(host),
    ctx,
    labels,
    entries,
    now: (ms) => {
      nowMs = ms;
    },
  };
}

function thinkingEvent(
  type: "thinking_start" | "thinking_delta" | "text_start",
  fields: { contentIndex?: number; delta?: string } = {},
): MessageUpdateEvent {
  return {
    type: "message_update",
    assistantMessageEvent: { type, ...fields },
  } as MessageUpdateEvent;
}

function assistantEnd(content: { type: string; thinking?: string }[], durationMs?: number): MessageEndEvent {
  return {
    type: "message_end",
    message: { role: "assistant", content, durationMs },
  } as MessageEndEvent;
}

function transform(session: ThinkingSession, markdown: string, width = 80): string {
  const context: MarkdownTransformContext = {
    messageType: "assistant-thinking",
    isStreaming: false,
    availableWidth: width,
  };
  return stripTerminalSequences(session.transformThinking(markdown, context));
}

test("a closed run renders its measured summary", () => {
  const h = harness();
  h.session.start(h.ctx);
  h.session.messageUpdate(thinkingEvent("thinking_start", { contentIndex: 0 }));
  h.session.messageUpdate(thinkingEvent("thinking_delta", { contentIndex: 0, delta: "plan the answer" }));
  h.now(3_200);
  h.session.messageUpdate(thinkingEvent("text_start", { contentIndex: 1 }));

  assert.equal(transform(h.session, "plan the answer"), "◆ Thought for 2.2s (4 tokens)");
});

test("other markdown passes through untouched", () => {
  const h = harness();
  const context: MarkdownTransformContext = { messageType: "assistant", isStreaming: false, availableWidth: 80 };
  assert.equal(h.session.transformThinking("# plain", context), "# plain");
});

test("while streaming, the rolling window shows instead of a summary", () => {
  const h = harness();
  h.session.messageUpdate(thinkingEvent("thinking_start", { contentIndex: 0 }));
  h.session.messageUpdate(thinkingEvent("thinking_delta", { contentIndex: 0, delta: "steer the plan" }));

  const line = transform(h.session, "steer the plan");
  assert.match(line, /^◆ Thinking/);
  assert.match(line, /steer/);
  assert.doesNotMatch(line, /Thought for/);
});

test("start resets the timing table and hydrates from the session entries", () => {
  const h = harness();
  h.session.messageUpdate(thinkingEvent("thinking_start", { contentIndex: 0 }));
  h.session.messageUpdate(thinkingEvent("thinking_delta", { contentIndex: 0, delta: "stale" }));
  h.session.messageUpdate(thinkingEvent("text_start", { contentIndex: 1 }));
  assert.match(transform(h.session, "stale"), /Thought for/);

  h.entries.push({
    type: "message",
    message: { role: "assistant", durationMs: 5_000, content: [{ type: "thinking", thinking: " hydrate me " }] },
  } as SessionEntry);
  h.session.start(h.ctx);
  assert.deepEqual(h.labels, ["◆ Thinking · click to expand"]);
  assert.equal(transform(h.session, "hydrate me"), "◆ Thought for 5.0s (3 tokens)");
  assert.doesNotMatch(transform(h.session, "stale"), /Thought for/);
});

test("message_end seeds joined groups with the response duration", () => {
  const h = harness();
  h.session.start(h.ctx);
  h.session.messageEnd(
    assistantEnd(
      [
        { type: "thinking", thinking: "first part" },
        { type: "thinking", thinking: "second part" },
      ],
      6_000,
    ),
  );
  assert.equal(transform(h.session, "first part\n\nsecond part"), "◆ Thought for 6.0s (6 tokens)");
});
