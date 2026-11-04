import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keyText } from "@earendil-works/pi-coding-agent";
import { createStatusSession } from "../src/status/session.ts";
import { WORKED_TYPE, type WorkedData, workedEntry } from "../src/status/worked.ts";

export default function (pi: ExtensionAPI) {
  const session = createStatusSession({
    now: () => Date.now(),
    interruptKey: () => keyText("app.interrupt"),
    sessionName: () => pi.getSessionName(),
    terminalColumns: () => process.stdout.columns,
    every: (callback, ms) => {
      const timer = setInterval(callback, ms);
      return () => clearInterval(timer);
    },
    appendWorked: (ms) => pi.appendEntry<WorkedData>(WORKED_TYPE, { ms }),
  });

  pi.registerEntryRenderer<WorkedData>(WORKED_TYPE, (entry, _options, renderTheme) =>
    workedEntry(entry.data, renderTheme),
  );
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    session.start(ctx);
  });
  pi.on("agent_start", (_event, ctx) => session.agentStart(ctx));
  pi.on("turn_start", () => session.turnStart());
  pi.on("message_update", (event) => session.messageUpdate(event));
  pi.on("tool_execution_start", (event) => session.toolExecutionStart(event.toolCallId));
  pi.on("tool_execution_end", (event) => session.toolExecutionEnd(event.toolCallId));
  pi.on("agent_settled", (event, ctx) => session.agentSettled(event.aborted, ctx));
  pi.on("session_shutdown", (_event, ctx) => session.shutdown(ctx));
}
