import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { RAIL_CHANNEL } from "../src/shared/channels.ts";
import { setRailCoveredColumns } from "../src/tools/rail.ts";
import { toolRenderers } from "../src/tools/renderers.ts";
import { createToolsSession } from "../src/tools/session.ts";
import { clearWriteRecords, recordWriteTarget } from "../src/tools/write.ts";

export default (pi: ExtensionAPI) => {
  const session = createToolsSession();

  pi.on("session_start", (_event, ctx) => {
    clearWriteRecords();
    session.start(ctx);
  });

  pi.on("message_start", (event, ctx) => session.messageStart(event, ctx));
  pi.on("message_update", (event, ctx) => session.messageUpdate(event, ctx));
  pi.on("message_end", (event, ctx) => session.messageEnd(event, ctx));
  pi.on("session_tree", (_event, ctx) => session.sessionTree(ctx));
  pi.on("session_shutdown", () => session.shutdown());

  // The navigation timeline covers the transcript's right columns; pad right-aligned text by its width.
  pi.events.on(RAIL_CHANNEL, (columns) => setRailCoveredColumns(columns as number));

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("write", event)) return;
    await recordWriteTarget(event.toolCallId, ctx.cwd, event.input.path);
  });

  pi.registerToolRenderer(toolRenderers);
};
