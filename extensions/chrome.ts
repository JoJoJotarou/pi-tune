import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createChromeSession } from "../src/chrome/session.ts";
import { editorHasFocus } from "../src/internals/focus.ts";
import { BTW_MODE_CHANNEL } from "../src/shared/btw.ts";

export default function (pi: ExtensionAPI) {
  const session = createChromeSession({
    commands: () => pi.getCommands(),
    allTools: () => pi.getAllTools(),
    mcpServers: () => pi.getMcpServers(),
    settings: () => pi.getSettings(),
    agentDir: () => getAgentDir(),
    now: () => Date.now(),
    editorFocused: (tui) => editorHasFocus(tui),
  });

  pi.events.on("pi-tune:editor-ready", () => session.editorReady());
  pi.events.on("pi-tune:editor-stash", (held) => session.editorStash(held === true));
  pi.events.on(BTW_MODE_CHANNEL, (open) => session.btwMode(open === true));
  pi.on("agent_start", () => session.agentStart());
  pi.on("turn_start", () => session.turnStart());
  pi.on("agent_settled", () => session.agentSettled());
  pi.on("message_update", (event) => session.messageUpdate(event));
  pi.on("message_end", (event) => session.messageEnd(event));
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    session.start(ctx);
  });
  pi.on("session_shutdown", () => session.shutdown());
}
