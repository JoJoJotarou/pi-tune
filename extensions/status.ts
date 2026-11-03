import { basename } from "node:path";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, keyText, type Theme } from "@earendil-works/pi-coding-agent";
import { formatDuration } from "../src/shared/format.ts";
import { type ActivityEvent, type ActivityState, describe, initialState, reduce } from "../src/status/activity.ts";

const REFRESH_MS = 250;
const DONE_TITLE_MS = 15_000;

function messageProgress(event: AssistantMessageEvent): "thinking" | "text" | undefined {
  switch (event.type) {
    case "thinking_start":
    case "thinking_delta":
    case "thinking_end":
      return "thinking";
    case "text_start":
    case "text_delta":
    case "text_end":
      return "text";
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
    const kind = messageProgress(event.assistantMessageEvent);
    if (kind) apply({ type: "message_update", kind });
  });

  pi.on("tool_execution_start", async (event) => {
    apply({ type: "tool_execution_start", id: event.toolCallId, name: event.toolName, args: event.args });
  });

  pi.on("tool_execution_end", async (event) => {
    apply({ type: "tool_execution_end", id: event.toolCallId });
  });

  pi.on("agent_settled", (event, context) => {
    if (shutDown) {
      state = reduce(state, { type: "agent_settled" }, Date.now());
      return;
    }
    ctx = context;
    const elapsed = Date.now() - state.startedAt;
    stopTimer();
    if (context.mode === "tui") {
      context.ui.setWorkingMessage();
      if (!event.aborted && elapsed >= DONE_TITLE_MS) {
        context.ui.setTitle(`✓ pi · done ${formatDuration(elapsed)}`);
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
