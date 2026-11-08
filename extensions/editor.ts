import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createEditorSession } from "../src/editor/session.ts";
import { BTW_MODE_CHANNEL, EDITOR_READY_CHANNEL, EDITOR_STASH_CHANNEL } from "../src/shared/channels.ts";

export default function (pi: ExtensionAPI) {
  const session = createEditorSession({
    settings: () => pi.getSettings(),
    agentDir: () => getAgentDir(),
    now: () => Date.now(),
    emitStash: (held) => pi.events.emit(EDITOR_STASH_CHANNEL, held),
    emitReady: () => pi.events.emit(EDITOR_READY_CHANNEL, undefined),
  });

  pi.events.on(BTW_MODE_CHANNEL, (on) => session.btwMode(on === true));
  pi.on("model_select", (event) => session.modelSelect(event));
  pi.on("thinking_level_select", (event) => session.thinkingLevelSelect(event));
  pi.on("agent_start", () => session.agentStart());
  pi.on("turn_end", (event) => session.turnEnd(event));
  pi.on("agent_settled", (event) => session.agentSettled(event));
  pi.on("session_compact", () => session.sessionCompact());
  pi.registerCommand("suggest", {
    description: "Turn next-step suggestions on/off and pick their model",
    getArgumentCompletions: (prefix) => session.suggestCompletions(prefix),
    handler: async (args, ctx) => session.runSuggestCommand(args, ctx),
  });
  pi.on("session_start", (_event, ctx) => session.start(ctx));
  pi.on("session_shutdown", () => session.shutdown());
}
