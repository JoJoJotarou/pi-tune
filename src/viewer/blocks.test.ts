import assert from "node:assert/strict";
import test from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { collectBlocks } from "./blocks.ts";

let seq = 0;

function messageEntry(message: unknown): SessionEntry {
  seq++;
  return {
    type: "message",
    id: `entry-${seq}`,
    parentId: null,
    timestamp: "2024-01-01T00:00:00.000Z",
    message,
  } as SessionEntry;
}

function assistant(content: unknown[]): SessionEntry {
  return messageEntry({
    role: "assistant",
    content,
    api: "faux",
    provider: "faux",
    model: "scripted",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {} },
    stopReason: "stop",
    timestamp: 0,
  });
}

function toolResult(toolCallId: string, toolName: string, text: string): SessionEntry {
  return messageEntry({
    role: "toolResult",
    toolCallId,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 0,
  });
}

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return { type: "toolCall", id, name, arguments: args };
}

test("tool result titles summarize the tool input", () => {
  const calls = [
    toolCall("1", "bash", { command: "seq 1 60\necho done" }),
    toolCall("2", "read", { path: "src/a.ts" }),
    toolCall("3", "edit", { path: "src/a.ts" }),
    toolCall("4", "write", { path: "notes.md" }),
    toolCall("5", "grep", { pattern: "TODO" }),
    toolCall("6", "find", { pattern: "*.ts" }),
    toolCall("7", "ls", { path: "src" }),
    toolCall("8", "ls", {}),
    toolCall("9", "custom", { anything: true }),
  ];
  const entries = [
    assistant(calls),
    toolResult("1", "bash", "1\n2\n3"),
    toolResult("2", "read", "const a = 1;"),
    toolResult("3", "edit", "applied"),
    toolResult("4", "write", "wrote"),
    toolResult("5", "grep", "src/a.ts:1:TODO"),
    toolResult("6", "find", "src/a.ts"),
    toolResult("7", "ls", "a.ts"),
    toolResult("8", "ls", "README.md"),
    toolResult("9", "custom", "whatever"),
  ];

  const blocks = collectBlocks(entries);

  assert.deepEqual(
    blocks.map((block) => block.title),
    [
      "bash · seq 1 60",
      "read · src/a.ts",
      "edit · src/a.ts",
      "write · notes.md",
      'grep · "TODO"',
      "find · *.ts",
      "ls · src",
      "ls · .",
      "custom",
    ],
  );
  assert.equal(blocks[0].body, "1\n2\n3");
  assert.equal(blocks[8].body, "whatever");
  assert.ok(blocks.every((block) => block.kind === "tool"));
});

test("code fences keep their language, title, body, and order", () => {
  const text = [
    "intro",
    "```ts",
    "const a = 1;",
    "```",
    "```",
    "plain text",
    "```",
    "```mermaid",
    "graph TD",
    "```",
    "```python",
    "print(1)",
    "```",
  ].join("\n");
  const entries = [
    assistant([toolCall("1", "bash", { command: "pwd" })]),
    toolResult("1", "bash", "/tmp"),
    assistant([{ type: "text", text }]),
  ];

  const blocks = collectBlocks(entries);

  assert.deepEqual(
    blocks.map((block) => block.title),
    ["bash · pwd", "ts code", "code", "mermaid", "python code"],
  );
  assert.deepEqual(
    blocks.map((block) => block.body),
    ["/tmp", "const a = 1;", "plain text", "graph TD", "print(1)"],
  );
  assert.deepEqual(
    blocks.map((block) => block.kind),
    ["tool", "code", "code", "code", "code"],
  );
});

test("non-message entries and messages without blocks are skipped", () => {
  const entries = [
    { type: "session_info", id: "s1", parentId: null, timestamp: "", name: "demo" },
    assistant([{ type: "text", text: "no fence here" }]),
  ] as SessionEntry[];
  assert.deepEqual(collectBlocks(entries), []);
});
