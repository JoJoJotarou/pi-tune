import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage, Message, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  type BtwThread,
  composeTurnText,
  countUserTurns,
  foldThreads,
  messageText,
  producedMessages,
  SIDE_THREAD_ADDENDUM,
  staleNotice,
  storedTurn,
  threadMessages,
  toolsNotice,
  turnReply,
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
  it("puts the addendum first, then the tools, the notice, and the question last", () => {
    assert.equal(composeTurnText("why?", { addendum: "A", tools: "T", notice: "N" }), "A\n\nT\n\nN\n\nwhy?");
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

  it("leaves the tool rules to the tools notice", () => {
    assert.doesNotMatch(SIDE_THREAD_ADDENDUM, /Do not call tools|tool calls/);
  });
});

describe("toolsNotice", () => {
  it("names the calls that run and the ones that never do", () => {
    const notice = toolsNotice(["read", "bash(tinyfish *)"], ["bash(rm *)"], false);
    assert.match(notice, /Only these tool calls run in this thread: read, bash\(tinyfish \*\)\./);
    assert.match(notice, /bash\(git log \*\) allows the bash commands that start that way/);
    assert.match(notice, /Never run: bash\(rm \*\)\./);
    assert.match(notice, /do not try it/);
    assert.doesNotMatch(notice, /changed/);
  });

  it("says when the rules changed, and when nothing runs", () => {
    const notice = toolsNotice([], [], true);
    assert.match(notice, /rules of this thread changed/);
    assert.match(notice, /No tool calls run in this thread\./);
    assert.doesNotMatch(notice, /bash\(git log/);
  });
});

describe("storedTurn and foldThreads", () => {
  it("stores one turn per entry and folds the entries back into threads", () => {
    const first = thread();
    const other: BtwThread = { id: "t2", anchorEntryId: "e20", anchorTurns: 5, turns: [] };
    const answer = thread().turns[1];
    const entries = [storedTurn(first, first.turns[0]), storedTurn(other, answer), storedTurn(first, first.turns[1])];
    for (const entry of entries) assert.equal(Object.keys(entry).sort().join(), "thread,turn");
    assert.deepEqual(entries[0].thread, { id: "t1", anchorEntryId: "e10", anchorTurns: 3 }, "no turns in the header");

    const { threads, skipped } = foldThreads(JSON.parse(JSON.stringify(entries)));
    assert.equal(skipped, 0);
    assert.deepEqual(
      threads.map((folded) => [folded.id, folded.anchorTurns, folded.turns.map((turn) => turn.question)]),
      [
        ["t1", 3, ["alpha?", "beta?"]],
        ["t2", 5, ["beta?"]],
      ],
    );
  });

  it("skips entries in another shape and counts them", () => {
    const valid = storedTurn(thread(), thread().turns[0]);
    const { threads, skipped } = foldThreads([{ threads: [] }, { thread: { id: "x" }, turn: {} }, valid, null]);
    assert.equal(skipped, 3);
    assert.equal(threads.length, 1);
  });
});
