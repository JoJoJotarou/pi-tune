import { basename } from "node:path";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, keyText, type Theme } from "@earendil-works/pi-coding-agent";
import { formatDuration } from "../src/shared/format.ts";
import { type ActivityEvent, type ActivityState, describe, initialState, reduce } from "../src/status/activity.ts";
import { sendNotification, shouldNotify } from "../src/status/notify.ts";

const REFRESH_MS = 250;

function messageProgress(
  event: AssistantMessageEvent,
): { kind: "thinking" | "text"; outputTokens: number } | undefined {
  switch (event.type) {
    case "thinking_start":
    case "thinking_delta":
    case "thinking_end":
      return { kind: "thinking", outputTokens: event.partial.usage.output };
    case "text_start":
    case "text_delta":
    case "text_end":
      return { kind: "text", outputTokens: event.partial.usage.output };
    default:
      return undefined;
  }
}

export default function (pi: ExtensionAPI) {
  let state: ActivityState = initialState;
  /** The TUI ctx the refresh timer draws through; cleared on shutdown. */
  let ctx: ExtensionContext | undefined;
  /** Stable theme object handed out by `session_start`, so renderers never touch a stored ctx. */
  let theme: Theme | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let notifyFailureReported = false;
  let shutDown = false;

  function stopTimer(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  function render(): void {
    if (ctx?.mode !== "tui" || !theme || !state.running) return;
    const width = Math.max(10, (process.stdout.columns ?? 80) - 6);
    ctx.ui.setWorkingMessage(describe(state, Date.now(), { width, interruptKey: keyText("app.interrupt"), theme }));
  }

  function apply(event: ActivityEvent): void {
    state = reduce(state, event, Date.now());
    render();
  }

  function titleForDefault(context: ExtensionContext): string {
    const cwd = basename(context.cwd);
    const session = pi.getSessionName();
    return session ? `π - ${session} - ${cwd}` : `π - ${cwd}`;
  }

  pi.on("session_start", (_event, context) => {
    if (context.mode !== "tui") return;
    theme = context.ui.theme;
    notifyFailureReported = false;
    shutDown = false;
  });

  pi.on("agent_start", async (_event, context) => {
    ctx = context;
    stopTimer();
    if (context.mode === "tui") {
      theme ??= context.ui.theme;
      context.ui.setTitle(titleForDefault(context));
    }
    apply({ type: "agent_start" });
    timer = setInterval(render, REFRESH_MS);
  });

  pi.on("turn_start", async () => {
    apply({ type: "turn_start" });
  });

  pi.on("message_update", async (event) => {
    const progress = messageProgress(event.assistantMessageEvent);
    if (progress) apply({ type: "message_update", ...progress });
  });

  pi.on("tool_execution_start", async (event) => {
    apply({ type: "tool_execution_start", id: event.toolCallId, name: event.toolName, args: event.args });
  });

  pi.on("tool_execution_end", async (event) => {
    apply({ type: "tool_execution_end", id: event.toolCallId });
  });

  pi.on("agent_settled", async (event, context) => {
    if (shutDown) {
      state = reduce(state, { type: "agent_settled" }, Date.now());
      return;
    }
    ctx = context;
    const elapsed = Date.now() - state.startedAt;
    stopTimer();
    if (context.mode === "tui") {
      context.ui.setWorkingMessage();
      if (shouldNotify(elapsed, event.aborted)) {
        const total = formatDuration(elapsed);
        context.ui.setTitle(`✓ pi · done ${total}`);
        try {
          await sendNotification("pi", `Done in ${total}`, { env: process.env, platform: process.platform });
        } catch (error) {
          if (!notifyFailureReported && !shutDown) {
            notifyFailureReported = true;
            context.ui.notify(`pi-tune notification failed: ${String(error)}`, "warning");
          }
        }
      }
    }
    apply({ type: "agent_settled" });
  });

  pi.on("session_shutdown", async (_event, context) => {
    shutDown = true;
    stopTimer();
    ctx = undefined;
    theme = undefined;
    if (context.mode === "tui") context.ui.setWorkingMessage();
  });
}
