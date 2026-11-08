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
    ui: { setHiddenThinkingLabel: (label) => labels.push(label ?? "") },
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
  type: "thinking_start" | "thinking_delta" | "thinking_end" | "text_start" | "toolcall_start",
  fields: { contentIndex?: number; delta?: string; content?: string } = {},
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

test("a run without thinking_end keeps the rolling window until message_end", () => {
  const h = harness();
  h.session.start(h.ctx);
  h.session.messageUpdate(thinkingEvent("thinking_start", { contentIndex: 0 }));
  h.session.messageUpdate(thinkingEvent("thinking_delta", { contentIndex: 0, delta: "plan the answer" }));
  h.now(3_200);
  h.session.messageUpdate(thinkingEvent("text_start", { contentIndex: 1 }));

  assert.match(transform(h.session, "plan the answer"), /^◆ Thinking/);

  h.session.messageEnd(assistantEnd([{ type: "thinking", thinking: "plan the answer" }, { type: "text" }]));
  assert.equal(transform(h.session, "plan the answer"), "◆ Thought for 2.2s (4 tokens)");
});

test("a late thinking_end never shows a stale summary first", () => {
  const h = harness();
  h.session.start(h.ctx);
  h.session.messageUpdate(thinkingEvent("thinking_start", { contentIndex: 0 }));
  h.session.messageUpdate(thinkingEvent("thinking_delta", { contentIndex: 0, delta: "plan the answer" }));
  h.now(1_500);
  h.session.messageUpdate(thinkingEvent("toolcall_start", { contentIndex: 1 }));

  // DeepSeek-style backends send thinking_end only at the end of the message; the run is not
  // final yet, so no duration may be claimed.
  assert.match(transform(h.session, "plan the answer"), /^◆ Thinking/);
  assert.doesNotMatch(transform(h.session, "plan the answer"), /Thought for/);

  h.now(2_200);
  h.session.messageUpdate(thinkingEvent("thinking_end", { contentIndex: 0, content: "plan the answer" }));
  assert.equal(transform(h.session, "plan the answer"), "◆ Thought for 1.2s (4 tokens)");

  h.session.messageEnd(assistantEnd([{ type: "thinking", thinking: "plan the answer" }, { type: "toolCall" }]));
  assert.equal(transform(h.session, "plan the answer"), "◆ Thought for 1.2s (4 tokens)");
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
  h.session.messageUpdate(thinkingEvent("thinking_end", { contentIndex: 0, content: "stale" }));
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

test("message_end keeps a measured run instead of the whole reply's duration", () => {
  const h = harness();
  h.session.start(h.ctx);
  h.session.messageUpdate(thinkingEvent("thinking_start", { contentIndex: 0 }));
  h.session.messageUpdate(thinkingEvent("thinking_delta", { contentIndex: 0, delta: "plan the answer" }));
  h.now(3_200);
  h.session.messageUpdate(thinkingEvent("text_start", { contentIndex: 1 }));
  h.session.messageEnd(assistantEnd([{ type: "thinking", thinking: "plan the answer" }, { type: "text" }], 20_000));

  assert.match(transform(h.session, "plan the answer"), /Thought for 2\.2s/);
});

test("message_end sums the measured runs of a joined group", () => {
  const h = harness();
  h.session.start(h.ctx);
  h.session.messageUpdate(thinkingEvent("thinking_start", { contentIndex: 0 }));
  h.now(2_000);
  h.session.messageUpdate(thinkingEvent("thinking_end", { contentIndex: 0, content: "first part" }));
  h.now(2_500);
  h.session.messageUpdate(thinkingEvent("thinking_start", { contentIndex: 1 }));
  h.now(4_000);
  h.session.messageUpdate(thinkingEvent("thinking_end", { contentIndex: 1, content: "second part" }));
  h.session.messageEnd(
    assistantEnd(
      [
        { type: "thinking", thinking: "first part" },
        { type: "thinking", thinking: "second part" },
      ],
      20_000,
    ),
  );

  assert.match(transform(h.session, "first part\n\nsecond part"), /Thought for 2\.5s/);
});

test("a group with an unmeasured run falls back to the whole reply's duration", () => {
  const h = harness();
  h.session.start(h.ctx);
  h.session.messageUpdate(thinkingEvent("thinking_start", { contentIndex: 0 }));
  h.now(2_000);
  h.session.messageUpdate(thinkingEvent("thinking_end", { contentIndex: 0, content: "first part" }));
  h.session.messageEnd(
    assistantEnd(
      [
        { type: "thinking", thinking: "first part" },
        { type: "thinking", thinking: "second part" },
      ],
      6_000,
    ),
  );

  assert.match(transform(h.session, "first part\n\nsecond part"), /Thought for 6\.0s/);
});
