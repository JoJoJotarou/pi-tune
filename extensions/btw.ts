import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { openSideSession } from "../src/btw/agent.ts";
import { createBtwSession } from "../src/btw/session.ts";
import { BTW_ENTRY_TYPE } from "../src/btw/thread.ts";
import { editorHasFocus } from "../src/internals/focus.ts";
import { BTW_MODE_CHANNEL } from "../src/shared/btw.ts";

export default function btwExtension(pi: ExtensionAPI) {
  const session = createBtwSession({
    now: () => Date.now(),
    emitBtwMode: (open) => pi.events.emit(BTW_MODE_CHANNEL, open),
    appendBtwEntry: (stored) => pi.appendEntry(BTW_ENTRY_TYPE, stored),
    agentDir: () => getAgentDir(),
    every: (callback, ms) => {
      const timer = setInterval(callback, ms);
      return () => clearInterval(timer);
    },
    editorFocused: (tui) => editorHasFocus(tui),
    openSideSession: (ctx, seeded, tools) =>
      openSideSession({ activeToolNames: pi.getActiveTools(), tools: pi.getAllTools() }, ctx, seeded, tools),
  });

  pi.on("session_start", (_event, ctx) => session.start(ctx));
  pi.on("session_tree", (_event, ctx) => session.sessionTree(ctx));
  pi.on("session_shutdown", () => session.shutdown());
  pi.on("message_start", (event) => session.messageStart(event));
  pi.on("input", async (event, ctx) => session.input(event, ctx));
  pi.registerCommand("btw", {
    description: "Ask a side question in a new thread, or pick a thread to continue",
    handler: async (args, ctx) => session.runBtwCommand(args, ctx),
  });
}
