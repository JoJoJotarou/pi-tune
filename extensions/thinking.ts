import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createThinkingSession } from "../src/thinking/session.ts";

export default (pi: ExtensionAPI) => {
  const session = createThinkingSession({
    now: () => Date.now(),
    colorEnabled: () => process.env.TERM !== "dumb" && !process.env.NO_COLOR,
    appendEntry: (customType, data) => pi.appendEntry(customType, data),
  });

  pi.registerMarkdownTransformer((markdown, context) => session.transformThinking(markdown, context));
  pi.on("session_start", (_event, ctx) => session.start(ctx));
  pi.on("message_start", (event) => session.messageStart(event));
  pi.on("message_update", (event) => session.messageUpdate(event));
  pi.on("message_end", (event) => session.messageEnd(event));
};
