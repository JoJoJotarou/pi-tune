import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { toolRenderers } from "../src/tools/renderers.ts";
import { clearWriteRecords, recordWriteTarget } from "../src/tools/write.ts";

export default (pi: ExtensionAPI) => {
  pi.on("session_start", () => clearWriteRecords());

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("write", event)) return;
    await recordWriteTarget(event.toolCallId, ctx.cwd, event.input.path);
  });

  pi.registerToolRenderer(toolRenderers);
};
