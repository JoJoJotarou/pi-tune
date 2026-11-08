import assert from "node:assert/strict";
import { test } from "node:test";
import { clearRuns, type PlanEntry, runHead, runView } from "./run.ts";
import { createToolsSession, type ToolsContext } from "./session.ts";

function assistant(...blocks: { type: string; id?: string; name?: string }[]): PlanEntry {
  return { type: "message", message: { role: "assistant", content: blocks } };
}

function toolCall(id: string, name: string): { type: string; id?: string; name?: string } {
  return { type: "toolCall", id, name };
}

function context(branch: PlanEntry[]): ToolsContext {
  return { sessionManager: { getBranch: () => branch as never } };
}

/** A streaming update whose partial message already carries `content`. */
function update(content: { type: string; id?: string; name?: string }[]): never {
  return {
    type: "message_update",
    message: { role: "assistant" },
    assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: { content } },
  } as never;
}

function assistantMessage(type: "message_start" | "message_end"): never {
  return { type, message: { role: "assistant" } } as never;
}

test("start plans the branch and shutdown clears it", () => {
  const session = createToolsSession();
  const ctx = context([assistant(toolCall("a", "read"), toolCall("b", "read"))]);

  session.start(ctx);
  assert.equal(runHead("a", false), "a");
  assert.equal(runHead("b", false), "a");

  session.shutdown();
  assert.equal(runHead("a", false), undefined);
});

test("a streaming message is planned before the branch carries it", () => {
  const session = createToolsSession();
  const ctx = context([]);
  session.start(ctx);

  session.messageUpdate(update([toolCall("a", "read"), toolCall("b", "read")]), ctx);
  assert.equal(runHead("b", false), "a");
  assert.deepEqual(
    runView("a")?.members.map((member) => member.id),
    ["a", "b"],
  );
});

test("the live copy is not planned twice once the message lands in the branch", () => {
  const branch: PlanEntry[] = [];
  const session = createToolsSession();
  const ctx = context(branch);
  session.start(ctx);
  const message = assistant(toolCall("a", "read"), toolCall("b", "read"));
  session.messageUpdate(update([toolCall("a", "read"), toolCall("b", "read")]), ctx);

  branch.push(message);
  session.messageEnd(assistantMessage("message_end"), ctx);
  assert.deepEqual(
    runView("a")?.members.map((member) => member.id),
    ["a", "b"],
  );

  // The branch now carries it; the next plan does not look at the stale live copy.
  session.messageStart(assistantMessage("message_start"), ctx);
  assert.deepEqual(
    runView("a")?.members.map((member) => member.id),
    ["a", "b"],
  );
});

test("text between two calls breaks the run", () => {
  const session = createToolsSession();
  const ctx = context([]);
  session.start(ctx);

  session.messageUpdate(update([toolCall("a", "read"), { type: "text" }, toolCall("b", "read")]), ctx);
  assert.equal(runHead("a", false), undefined);
  assert.equal(runHead("b", false), undefined);
});

test("tree navigation drops the live copy", () => {
  const session = createToolsSession();
  const ctx = context([]);
  session.start(ctx);
  session.messageUpdate(update([toolCall("a", "read"), toolCall("b", "read")]), ctx);

  session.sessionTree(ctx);
  assert.equal(runHead("a", false), undefined);
});

test("clearRuns forgets the plan between sessions", () => {
  const session = createToolsSession();
  const ctx = context([assistant(toolCall("a", "read"), toolCall("b", "read"))]);
  session.start(ctx);
  clearRuns();
  assert.equal(runHead("a", false), undefined);
});
