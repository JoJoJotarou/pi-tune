import type {
  ExtensionContext,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import { clearRuns, type PlanEntry, planRuns, setRunPlan } from "./run.ts";

/** The part of Pi's `ExtensionContext` the tools session uses. */
export interface ToolsContext {
  sessionManager: Pick<ExtensionContext["sessionManager"], "getBranch">;
}

export interface ToolsSession {
  start(ctx: ToolsContext): void;
  messageStart(event: MessageStartEvent, ctx: ToolsContext): void;
  messageUpdate(event: MessageUpdateEvent, ctx: ToolsContext): void;
  messageEnd(event: MessageEndEvent, ctx: ToolsContext): void;
  sessionTree(ctx: ToolsContext): void;
  shutdown(): void;
}

export function createToolsSession(): ToolsSession {
  /** The assistant message still streaming; the branch only carries it once it has ended. */
  let pending: PlanEntry | undefined;

  const rebuild = (ctx: ToolsContext): void => {
    const branch = ctx.sessionManager.getBranch() as readonly PlanEntry[];
    // The branch lags the message being streamed. `planRuns` counts a call id once, so appending
    // the live copy stays correct after the message also lands in the branch.
    setRunPlan(planRuns(pending === undefined ? branch : [...branch, pending]));
  };

  return {
    start(ctx) {
      clearRuns();
      pending = undefined;
      rebuild(ctx);
    },
    messageStart(event, ctx) {
      if (event.message.role !== "assistant") return;
      pending = undefined;
      rebuild(ctx);
    },
    // Fold while the tool calls still stream, not when the message lands: Pi paints each call's row
    // as soon as its block arrives, and a row that starts alone must already know it is a run.
    messageUpdate(event, ctx) {
      const assistant = event.assistantMessageEvent;
      if (assistant === undefined) return;
      if (
        assistant.type !== "toolcall_start" &&
        assistant.type !== "toolcall_end" &&
        assistant.type !== "text_start" &&
        assistant.type !== "thinking_start"
      ) {
        return;
      }
      pending = { type: "message", message: { role: "assistant", content: assistant.partial.content } };
      rebuild(ctx);
    },
    messageEnd(event, ctx) {
      if (event.message.role !== "assistant") return;
      rebuild(ctx);
    },
    // Tree navigation redraws the transcript from another branch.
    sessionTree(ctx) {
      pending = undefined;
      rebuild(ctx);
    },
    shutdown() {
      pending = undefined;
      clearRuns();
    },
  };
}
