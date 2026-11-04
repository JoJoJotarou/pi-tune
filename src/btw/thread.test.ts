import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage, Message, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  type BtwThread,
  composeTurnText,
  countUserTurns,
  messageText,
  producedMessages,
  SIDE_THREAD_ADDENDUM,
  staleNotice,
  threadMessages,
  turnReply,
  turnToolCalls,
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
      {
        text: "<addendum>\n\n[notice]\n\nalpha?",
        question: "alpha?",
        messages: [assistant("first", 2)],
        askedAt: 2,
        durationMs: 1,
        denied: [],
      },
      { text: "beta?", question: "beta?", messages: [assistant("second", 4)], askedAt: 4, durationMs: 1, denied: [] },
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
    assert.equal(messages[1], original.turns[0].messages[0]);
    assert.equal(messages[3], original.turns[1].messages[0]);
    assert.equal(JSON.stringify(original), snapshot, "replay must not mutate the thread");
  });

  it("replays a turn's tool calls and results before its answer", () => {
    const call = assistant("let me look");
    call.content.push({ type: "toolCall", id: "c1", name: "read", arguments: { path: "a" } });
    const result: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "read",
      content: [{ type: "text", text: "file a" }],
      isError: false,
      timestamp: 3,
    };
    const original = thread();
    original.turns[0].messages = [call, result, assistant("first", 2)];
    const messages = threadMessages(original);
    assert.deepEqual(
      messages.map((message) => message.role),
      ["user", "assistant", "toolResult", "assistant", "user", "assistant"],
    );
    assert.equal(messageText(turnReply(original.turns[0])), "first");
    assert.equal(turnToolCalls(original.turns[0]), 1);
  });

  it("serializes to the same bytes on every replay", () => {
    const original = thread();
    assert.equal(JSON.stringify(threadMessages(original)), JSON.stringify(threadMessages(original)));
  });
});

describe("messageText", () => {
  it("joins the text blocks and skips thinking", () => {
    const message = assistant("a");
    message.content = [
      { type: "thinking", thinking: "hmm" },
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ];
    assert.equal(messageText(message), "ab");
  });
});

describe("producedMessages", () => {
  it("keeps everything after the last question, tool rounds included", () => {
    const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }], timestamp: 1 });
    const result: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "read",
      content: [{ type: "text", text: "x" }],
      isError: false,
      timestamp: 2,
    };
    const call = assistant("looking");
    const answer = assistant("done");
    const produced = producedMessages([user("old"), assistant("old answer"), user("new"), call, result, answer]);
    assert.deepEqual(produced, [call, result, answer]);
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

  it("lets the model look things up and says refused calls come back as errors", () => {
    assert.match(SIDE_THREAD_ADDENDUM, /may use tools to look things up/);
    assert.match(SIDE_THREAD_ADDENDUM, /not allowed comes back as an error/);
    assert.doesNotMatch(SIDE_THREAD_ADDENDUM, /Do not call tools/);
  });
});
