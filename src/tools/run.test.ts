import assert from "node:assert/strict";
import { mock, test } from "node:test";
import {
  callExpanded,
  clearRuns,
  type PlanEntry,
  planRuns,
  type Run,
  recordFacts,
  runCountLabel,
  runHead,
  runView,
  setHeadExpanded,
  setRunPlan,
  toggleCallExpanded,
} from "./run.ts";

function assistant(...blocks: { type: string; id?: string; name?: string }[]): PlanEntry {
  return { type: "message", message: { role: "assistant", content: blocks } };
}

function toolCall(id: string, name: string): { type: string; id?: string; name?: string } {
  return { type: "toolCall", id, name };
}

function twoReads(): Run {
  return {
    headId: "a",
    members: [
      { id: "a", name: "read" },
      { id: "b", name: "read" },
    ],
  };
}

function plan(...runs: Run[]): void {
  clearRuns();
  setRunPlan(runs);
}

test("plans consecutive mergeable calls as one run", () => {
  const runs = planRuns([assistant(toolCall("a", "read"), toolCall("b", "read"), toolCall("c", "grep"))]);
  assert.deepEqual(
    runs.map((run) => run.members.map((member) => member.id)),
    [["a", "b", "c"]],
  );
  assert.equal(runs[0].headId, "a");
});

test("a run breaks at text, thinking, non-mergeable tools, and non-message entries", () => {
  const entries: PlanEntry[] = [
    assistant(toolCall("a", "read"), { type: "text" }, toolCall("b", "read")),
    assistant({ type: "thinking" }, toolCall("c", "read"), toolCall("d", "bash"), toolCall("e", "read")),
    { type: "compaction" },
    assistant(toolCall("f", "read"), toolCall("g", "read")),
  ];
  // Every fragment except [f, g] is a single call, and single calls are never grouped.
  assert.deepEqual(
    planRuns(entries).map((run) => run.members.map((member) => member.id)),
    [["f", "g"]],
  );
});

test("a user message, a string body, and single calls are never grouped", () => {
  const entries: PlanEntry[] = [
    { type: "message", message: { role: "user" } },
    assistant(toolCall("a", "read")),
    { type: "message", message: { role: "assistant", content: "plain text" } },
    assistant(toolCall("b", "read"), toolCall("c", "read")),
  ];
  assert.deepEqual(
    planRuns(entries).map((run) => run.members.map((member) => member.id)),
    [["b", "c"]],
  );
});

test("a call id the branch and the live copy both carry is planned once", () => {
  const message = assistant(toolCall("a", "read"), toolCall("b", "read"));
  assert.deepEqual(
    planRuns([message, message]).map((run) => run.members.map((member) => member.id)),
    [["a", "b"]],
  );
});

test("the head draws, members hide, and Pi's expansion ungroups everything", () => {
  plan(twoReads());
  assert.equal(runHead("a", false), "a");
  assert.equal(runHead("b", false), "a");
  assert.equal(runHead("missing", false), undefined);
  assert.equal(runHead("a", true), undefined);
  assert.equal(runView("missing"), undefined);
});

test("a run stays open until every call has a result", () => {
  plan(twoReads());
  // The model has emitted the calls but none has reported yet: the card is open, waiting for rows.
  assert.equal(runView("a")?.open, true);

  recordFacts("a", { status: "running" });
  recordFacts("b", { status: "running" });
  assert.equal(runView("a")?.open, true);

  // A finished call keeps the run open: it leaves with the last row, not on its own.
  recordFacts("a", { status: "success", durationMs: 10 });
  assert.equal(runView("a")?.open, true);

  recordFacts("b", { status: "error", durationMs: 5 });
  const view = runView("a");
  assert.equal(view?.open, false);
  assert.deepEqual(view?.statuses, ["success", "error"]);
});

test("the user's choice overrides the run's own state", () => {
  plan(twoReads());
  recordFacts("a", { status: "running" });
  recordFacts("b", { status: "running" });

  setHeadExpanded("a", false);
  assert.equal(runView("a")?.open, false);

  setHeadExpanded("a", true);
  recordFacts("a", { status: "success", durationMs: 10 });
  recordFacts("b", { status: "success", durationMs: 10 });
  assert.equal(runView("a")?.open, true);
});

test("concurrent calls report wall-clock time, not the sum", () => {
  mock.timers.enable({ apis: ["Date"] });
  try {
    plan(twoReads());
    recordFacts("a", { status: "running" });
    recordFacts("b", { status: "running" });
    recordFacts("a", { status: "success", durationMs: 1200 });
    recordFacts("b", { status: "success", durationMs: 1200 });
    assert.equal(runView("a")?.durationMs, 1200);
  } finally {
    mock.timers.reset();
  }
});

test("a resumed session sums the known durations instead", () => {
  plan(twoReads());
  recordFacts("a", { status: "success", durationMs: 100 });
  recordFacts("b", { status: "success", durationMs: 20 });
  assert.equal(runView("a")?.durationMs, 120);
});

test("a durationless member leaves the group's duration out", () => {
  plan(twoReads());
  recordFacts("a", { status: "success" });
  recordFacts("b", { status: "success", durationMs: 10 });
  assert.equal(runView("a")?.durationMs, undefined);
});

test("a call body toggles on its own, inside an expanded group", () => {
  plan(twoReads());
  assert.equal(callExpanded("b"), false);
  toggleCallExpanded("b");
  assert.equal(callExpanded("b"), true);
  toggleCallExpanded("b");
  assert.equal(callExpanded("b"), false);
});

test("the group counts what the calls did, not their tool names", () => {
  assert.equal(runCountLabel(["read", "read", "grep"]), "2 reads · 1 search");
  assert.equal(runCountLabel(["ls", "find"]), "1 search · 1 list");
  assert.equal(runCountLabel(["read", "grep", "find", "ls"]), "1 read · 2 searches · 1 list");
  assert.equal(runCountLabel(["mcp_docs"]), "1 mcp_docs");
});
