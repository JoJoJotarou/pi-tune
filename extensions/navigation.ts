import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { asScrollable, collectPrompts, jumpTo } from "../src/internals/transcript.ts";
import { createNavigationSession } from "../src/navigation/session.ts";
import { RAIL_CHANNEL } from "../src/shared/channels.ts";

export default function (pi: ExtensionAPI) {
  const session = createNavigationSession({
    scrollable: asScrollable,
    prompts: collectPrompts,
    jumpTo,
    publish: (covered) => {
      pi.events.emit(RAIL_CHANNEL, covered);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    session.start(ctx);
  });
  pi.on("session_shutdown", () => session.shutdown());
  pi.registerCommand("timeline", {
    description: "Jump to a prompt in this session",
    handler: async (_args, ctx) => session.runTimelineCommand(ctx),
  });
}
