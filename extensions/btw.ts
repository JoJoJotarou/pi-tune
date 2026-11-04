import type { AssistantMessage } from "@earendil-works/pi-ai";
import { buildSessionContext, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { openSideSession } from "../src/btw/child.ts";
import {
  BTW_ENTRY_TYPE,
  type BtwThread,
  composeTurnText,
  countUserTurns,
  SIDE_THREAD_ADDENDUM,
  staleNotice,
  threadMessages,
  turnAnswer,
} from "../src/btw/thread.ts";

function lastAssistant(session: { state: { messages: readonly { role: string }[] } }): AssistantMessage | undefined {
  for (let index = session.state.messages.length - 1; index >= 0; index--) {
    const message = session.state.messages[index];
    if (message.role === "assistant") return message as AssistantMessage;
  }
  return undefined;
}

export default function btwExtension(pi: ExtensionAPI) {
  let thread: BtwThread | null = null;

  /** The main session's messages up to the anchor, exactly as the parent sends them. */
  function mainSnapshot(
    ctx: ExtensionCommandContext,
    anchorEntryId: string | null,
  ): ReturnType<typeof buildSessionContext>["messages"] {
    const entries = ctx.sessionManager.getEntries();
    return buildSessionContext(entries, anchorEntryId ?? ctx.sessionManager.getLeafId()).messages;
  }

  pi.on("session_start", async (_event, ctx) => {
    thread = null;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === BTW_ENTRY_TYPE) {
        thread = (entry as unknown as { data?: BtwThread }).data ?? null;
      }
    }
  });

  pi.registerCommand("btw", {
    description: "Ask a side question without touching the main conversation",
    handler: async (args, ctx) => {
      const question = args.trim();
      if (!question) {
        ctx.ui.notify("Usage: /btw <question>", "warning");
        return;
      }
      if (!ctx.model) {
        ctx.ui.notify("No active model to answer the side question.", "error");
        return;
      }

      const anchorEntryId = thread?.anchorEntryId ?? ctx.sessionManager.getLeafId();
      const snapshot = mainSnapshot(ctx, thread ? thread.anchorEntryId : anchorEntryId);
      const mainTurns = countUserTurns(mainSnapshot(ctx, ctx.sessionManager.getLeafId()));
      if (!thread) {
        thread = {
          id: `btw-${Date.now().toString(36)}`,
          anchorEntryId: anchorEntryId ?? "",
          anchorTurns: countUserTurns(snapshot),
          turns: [],
        };
      }

      const text = composeTurnText(question, {
        addendum: thread.turns.length === 0 ? SIDE_THREAD_ADDENDUM : undefined,
        notice: staleNotice(thread.anchorTurns, mainTurns),
      });

      const session = await openSideSession(pi, ctx, [...snapshot, ...threadMessages(thread)]);
      try {
        await session.prompt(text, { source: "extension" });
        const message = lastAssistant(session);
        if (!message) {
          ctx.ui.notify("The side question finished without an answer.", "error");
          return;
        }
        if (message.stopReason === "error") {
          ctx.ui.notify(message.errorMessage || "The side question failed.", "error");
          return;
        }
        thread.turns.push({ text, question, message, askedAt: Date.now() });
        pi.appendEntry(BTW_ENTRY_TYPE, thread);
        ctx.ui.notify(turnAnswer({ text, question, message, askedAt: 0 }).trim() || "(empty answer)", "info");
      } finally {
        session.dispose();
      }
    },
  });
}
