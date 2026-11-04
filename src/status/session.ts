import { basename } from "node:path";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { ExtensionContext, MessageUpdateEvent, Theme } from "@earendil-works/pi-coding-agent";
import { type ActivityEvent, type ActivityState, describe, doneTitle, initialState, reduce } from "./activity.ts";

const REFRESH_MS = 250;

/** What the status session reads from the running Pi instance; injected so tests can fake it. */
export interface StatusHost {
  now(): number;
  /** `keyText("app.interrupt")`: the key that stops the run. */
  interruptKey(): string;
  /** `pi.getSessionName()`. */
  sessionName(): string | undefined;
  terminalColumns(): number | undefined;
  /** Runs `callback` every `ms` until the returned cancel is called; `setInterval` in the extension. */
  every(callback: () => void, ms: number): () => void;
  /** Appends the finished run's `Worked for …` entry; `pi.appendEntry` in the extension. */
  appendWorked(ms: number): void;
}

/** The part of Pi's `ExtensionContext` the status session uses. */
export interface StatusContext {
  mode: ExtensionContext["mode"];
  cwd: string;
  ui: {
    readonly theme: Theme;
    setWorkingMessage(message?: string): void;
    setTitle(title: string): void;
  };
}

export interface StatusSession {
  start(ctx: StatusContext): void;
  agentStart(ctx: StatusContext): void;
  turnStart(): void;
  messageUpdate(event: MessageUpdateEvent): void;
  toolExecutionStart(id: string): void;
  toolExecutionEnd(id: string): void;
  agentSettled(aborted: boolean, ctx: StatusContext): void;
  shutdown(ctx: StatusContext): void;
}

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

export function createStatusSession(host: StatusHost): StatusSession {
  let state: ActivityState = initialState;
  /** The TUI ctx the refresh timer draws through; cleared on shutdown. */
  let ctx: StatusContext | undefined;
  /** Stable theme object handed out by `session_start`, so renderers never touch a stored ctx. */
  let theme: Theme | undefined;
  let stopRefresh: (() => void) | undefined;
  let shutDown = false;

  function stopTimer(): void {
    stopRefresh?.();
    stopRefresh = undefined;
  }

  function render(): void {
    if (ctx?.mode !== "tui" || !theme || !state.running) return;
    const width = Math.max(10, (host.terminalColumns() ?? 80) - 6);
    ctx.ui.setWorkingMessage(describe(state, host.now(), { width, interruptKey: host.interruptKey(), theme }));
  }

  function apply(event: ActivityEvent): void {
    state = reduce(state, event, host.now());
    render();
  }

  function titleForDefault(context: StatusContext): string {
    const cwd = basename(context.cwd);
    const session = host.sessionName();
    return session ? `π - ${session} - ${cwd}` : `π - ${cwd}`;
  }

  return {
    start(context) {
      theme = context.ui.theme;
      shutDown = false;
    },
    agentStart(context) {
      ctx = context;
      stopTimer();
      if (context.mode === "tui") {
        theme ??= context.ui.theme;
        context.ui.setTitle(titleForDefault(context));
      }
      apply({ type: "agent_start" });
      stopRefresh = host.every(render, REFRESH_MS);
    },
    turnStart() {
      apply({ type: "turn_start" });
    },
    messageUpdate(event) {
      const kind = messageProgress(event.assistantMessageEvent);
      if (kind) apply({ type: "message_update", kind });
    },
    toolExecutionStart(id) {
      apply({ type: "tool_execution_start", id });
    },
    toolExecutionEnd(id) {
      apply({ type: "tool_execution_end", id });
    },
    agentSettled(aborted, context) {
      if (shutDown) {
        state = reduce(state, { type: "agent_settled" }, host.now());
        return;
      }
      ctx = context;
      const elapsed = host.now() - state.startedAt;
      stopTimer();
      if (context.mode === "tui") {
        context.ui.setWorkingMessage();
        const title = doneTitle(elapsed, aborted);
        if (title !== undefined) context.ui.setTitle(title);
      }
      host.appendWorked(elapsed);
      apply({ type: "agent_settled" });
    },
    shutdown(context) {
      shutDown = true;
      stopTimer();
      ctx = undefined;
      theme = undefined;
      if (context.mode === "tui") context.ui.setWorkingMessage();
    },
  };
}
