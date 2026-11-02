import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { toolRenderers } from "../src/tools/renderers.ts";

export default (pi: ExtensionAPI) => pi.registerToolRenderer(toolRenderers);
