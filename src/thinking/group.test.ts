import assert from "node:assert/strict";
import { test } from "node:test";
import { groupThinkingBlocks } from "./group.ts";

test("consecutive thinking blocks join into one group", () => {
  const groups = groupThinkingBlocks([
    { type: "thinking", thinking: " first " },
    { type: "thinking", thinking: "second" },
  ]);
  assert.deepEqual(groups, [{ text: "first\n\nsecond", indexes: [0, 1] }]);
});

test("any other block ends a group", () => {
  const groups = groupThinkingBlocks([
    { type: "thinking", thinking: "plan" },
    { type: "text" },
    { type: "thinking", thinking: "check" },
    { type: "toolCall" },
  ]);
  assert.deepEqual(groups, [
    { text: "plan", indexes: [0] },
    { text: "check", indexes: [2] },
  ]);
});

test("empty thinking blocks are skipped without splitting the group", () => {
  const groups = groupThinkingBlocks([
    { type: "thinking", thinking: "plan" },
    { type: "thinking", thinking: "  " },
    { type: "thinking" },
    { type: "thinking", thinking: "check" },
  ]);
  assert.deepEqual(groups, [{ text: "plan\n\ncheck", indexes: [0, 3] }]);
});

test("a reply without thinking has no groups", () => {
  assert.deepEqual(groupThinkingBlocks([{ type: "text" }]), []);
});
