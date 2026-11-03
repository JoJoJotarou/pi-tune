import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { RAIL_CHANNEL } from "../src/shared/rail.ts";
import { setRailCoveredColumns } from "../src/tools/rail.ts";
import { toolRenderers } from "../src/tools/renderers.ts";
import { clearWriteRecords, recordWriteTarget } from "../src/tools/write.ts";

export default (pi: ExtensionAPI) => {
  pi.on("session_start", () => clearWriteRecords());

  // The navigation timeline covers the transcript's right columns; pad right-aligned text by its width.
  pi.events.on(RAIL_CHANNEL, (columns) => setRailCoveredColumns(columns as number));

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("write", event)) return;
    await recordWriteTarget(event.toolCallId, ctx.cwd, event.input.path);
  });

  pi.registerToolRenderer(toolRenderers);
};
