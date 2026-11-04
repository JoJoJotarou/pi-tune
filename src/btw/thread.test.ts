import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import {
  type BtwThread,
  composeTurnText,
  countUserTurns,
  SIDE_THREAD_ADDENDUM,
  staleNotice,
  threadMessages,
  turnAnswer,
} from "./thread.ts";

function assistant(text: string, timestamp = 1): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "probe",
    model: "probe-model",
    api: "openai-completions",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp,
  } as AssistantMessage;
}

function thread(): BtwThread {
  return {
    id: "t1",
    anchorEntryId: "e10",
    anchorTurns: 3,
    turns: [
      { text: "<addendum>\n\n[notice]\n\nalpha?", question: "alpha?", message: assistant("first", 2), askedAt: 2 },
      { text: "beta?", question: "beta?", message: assistant("second", 4), askedAt: 4 },
    ],
  };
}

describe("composeTurnText", () => {
  it("puts the addendum first, the notice next, the question last", () => {
    assert.equal(composeTurnText("why?", { addendum: "A", notice: "N" }), "A\n\nN\n\nwhy?");
  });

  it("omits missing parts without leaving blank lines", () => {
    assert.equal(composeTurnText("why?", { notice: "N" }), "N\n\nwhy?");
    assert.equal(composeTurnText("why?"), "why?");
    assert.equal(composeTurnText("why?", { addendum: "", notice: "" }), "why?");
  });
});

describe("staleNotice", () => {
  it("is absent while the thread is in sync", () => {
    assert.equal(staleNotice(3, 3), undefined);
    assert.equal(staleNotice(3, 2), undefined);
  });

  it("names the anchor and the number of missing turns", () => {
    const one = staleNotice(3, 4);
    assert.match(one ?? "", /anchored at main turn 3/);
    assert.match(one ?? "", /now at turn 4/);
    assert.match(one ?? "", /1 main-session turn happened/);

    const many = staleNotice(10, 15);
    assert.match(many ?? "", /5 main-session turns happened/);
  });
});

describe("threadMessages", () => {
  it("replays the stored bytes exactly", () => {
    const original = thread();
    const snapshot = JSON.stringify(original);
    const messages = threadMessages(original);
    assert.equal(messages.length, 4);
    assert.deepEqual(messages[0], {
      role: "user",
      content: [{ type: "text", text: "<addendum>\n\n[notice]\n\nalpha?" }],
      timestamp: 2,
    });
    assert.equal(messages[1], original.turns[0].message);
    assert.equal(messages[3], original.turns[1].message);
    assert.equal(JSON.stringify(original), snapshot, "replay must not mutate the thread");
  });

  it("serializes to the same bytes on every replay", () => {
    const original = thread();
    assert.equal(JSON.stringify(threadMessages(original)), JSON.stringify(threadMessages(original)));
  });
});

describe("turnAnswer", () => {
  it("joins the text blocks and skips thinking", () => {
    const message = assistant("a");
    message.content = [
      { type: "thinking", thinking: "hmm" },
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ];
    assert.equal(turnAnswer({ ...thread().turns[0], message }), "ab");
  });
});

describe("countUserTurns", () => {
  it("counts only user messages", () => {
    const messages: Message[] = [
      { role: "user", content: [{ type: "text", text: "a" }], timestamp: 1 },
      assistant("b"),
      { role: "user", content: [{ type: "text", text: "c" }], timestamp: 3 },
    ];
    assert.equal(countUserTurns(messages), 2);
  });
});

describe("SIDE_THREAD_ADDENDUM", () => {
  it("describes follow-ups instead of a one-off question", () => {
    assert.match(SIDE_THREAD_ADDENDUM, /side thread/);
    assert.doesNotMatch(SIDE_THREAD_ADDENDUM, /one-off|no follow-up/i);
  });
});
