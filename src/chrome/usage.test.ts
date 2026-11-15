import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { sessionUsage } from "./usage.ts";

function usage(input: number, output: number, cacheRead: number, cacheWrite: number, cost: number): Usage {
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

const at = { id: "e1", parentId: null, timestamp: "2024-01-01T00:00:00.000Z" };

function assistant(used: Usage, stopReason: "stop" | "pending" = "stop"): SessionEntry {
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    provider: "probe",
    model: "probe-model",
    api: "openai-completions",
    usage: used,
    stopReason,
    timestamp: 1,
  };
  return { ...at, type: "message", message };
}

function toolResult(used: Usage | undefined): SessionEntry {
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId: "c1",
    toolName: "read",
    content: [],
    isError: false,
    timestamp: 1,
    ...(used ? { usage: used } : {}),
  };
  return { ...at, type: "message", message };
}

test("an assistant message's input, output, cache and cost all reach the totals", () => {
  const totals = sessionUsage([assistant(usage(100, 20, 300, 100, 0.25))]);
  assert.deepEqual(totals, {
    input: 100,
    output: 20,
    cacheRead: 300,
    cacheWrite: 100,
    cost: 0.25,
    cacheHitPercent: 60,
  });
});

test("tool results, usage entries and both summary entries add their usage", () => {
  const entries: SessionEntry[] = [
    {
      ...at,
      type: "usage",
      kind: "cache_warm",
      provider: "probe",
      model: "probe-model",
      usage: usage(1, 2, 3, 4, 0.01),
    },
    toolResult(usage(10, 20, 30, 40, 0.02)),
    { ...at, type: "branch_summary", fromId: "e0", summary: "s", usage: usage(100, 200, 300, 400, 0.03) },
    {
      ...at,
      type: "compaction",
      summary: "s",
      firstKeptEntryId: "e0",
      tokensBefore: 10,
      usage: usage(1000, 2000, 3000, 4000, 0.04),
    },
  ];
  assert.deepEqual(sessionUsage(entries), {
    input: 1111,
    output: 2222,
    cacheRead: 3333,
    cacheWrite: 4444,
    cost: 0.1,
  });
});

test("a tool result without usage, and every entry that carries none, add nothing", () => {
  const entries: SessionEntry[] = [
    { ...at, type: "model_change", provider: "probe", modelId: "probe-model" },
    { ...at, type: "custom", customType: "pi-tune:worked", data: { ms: 10 } },
    { ...at, type: "branch_summary", fromId: "e0", summary: "s" },
    toolResult(undefined),
  ];
  assert.deepEqual(sessionUsage(entries), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
});

test("the cache hit rate is the latest assistant message's, over its whole prompt", () => {
  const totals = sessionUsage([
    assistant(usage(1000, 10, 0, 0, 0), "stop"),
    assistant(usage(100, 10, 300, 100, 0), "stop"),
  ]);
  assert.equal(totals.cacheHitPercent, 60);
});

test("a later assistant message with an empty prompt clears the rate", () => {
  const totals = sessionUsage([assistant(usage(100, 10, 300, 100, 0)), assistant(usage(0, 10, 0, 0, 0))]);
  assert.equal(totals.cacheHitPercent, undefined);
});

test("only assistant messages set the rate; every other entry leaves it alone", () => {
  const totals = sessionUsage([
    assistant(usage(100, 10, 300, 100, 0)),
    toolResult(usage(1, 1, 99_999, 1, 0)),
    { ...at, type: "usage", kind: "other", provider: "probe", model: "probe-model", usage: usage(1, 1, 1, 1, 0.5) },
    { ...at, type: "branch_summary", fromId: "e0", summary: "s", usage: usage(0, 0, 500, 0, 0) },
    { ...at, type: "compaction", summary: "s", firstKeptEntryId: "e0", tokensBefore: 1, usage: usage(0, 0, 500, 0, 0) },
  ]);
  assert.equal(totals.cacheHitPercent, 60);
  assert.equal(totals.input, 102);
  assert.equal(totals.cacheRead, 101_300);
});

test("an empty session is all zeroes and has no rate", () => {
  assert.deepEqual(sessionUsage([]), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
});
