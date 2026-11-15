import { basename } from "node:path";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { ExtensionContext, MessageEndEvent, MessageUpdateEvent, Theme } from "@earendil-works/pi-coding-agent";
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
  ui: Pick<ExtensionContext["ui"], "theme" | "setWorkingMessage" | "setTitle">;
}

export interface StatusSession {
  start(ctx: StatusContext): void;
  agentStart(ctx: StatusContext): void;
  turnStart(): void;
  messageUpdate(event: MessageUpdateEvent): void;
  messageEnd(event: MessageEndEvent): void;
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
  /** Whether the run's last message came back as a provider error; a failed run gets no done title. */
  let failed = false;

  function stopTimer(): void {
    stopRefresh?.();
    stopRefresh = undefined;
  }

  function reset(): void {
    stopTimer();
    ctx = undefined;
    theme = undefined;
    state = initialState;
    failed = false;
  }

  function render(): void {
    if (ctx?.mode !== "tui" || !theme || !state.running) return;
    const width = Math.max(10, (host.terminalColumns() ?? 80) - 6);
    ctx.ui.setWorkingMessage(describe(state, host.now(), { width, interruptKey: host.interruptKey(), theme }));
  }

  function apply(event: ActivityEvent): void {
    const next = reduce(state, event, host.now());
    if (next === state) return;
    state = next;
    render();
  }

  function titleForDefault(context: StatusContext): string {
    const cwd = basename(context.cwd);
    const session = host.sessionName();
    return session ? `π - ${session} - ${cwd}` : `π - ${cwd}`;
  }

  return {
    start(context) {
      reset();
      theme = context.ui.theme;
    },
    agentStart(context) {
      ctx = context;
      stopTimer();
      failed = false;
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
    messageEnd(event) {
      if (event.message.role !== "assistant") return;
      failed = event.message.stopReason === "error";
    },
    toolExecutionStart(id) {
      apply({ type: "tool_execution_start", id });
    },
    toolExecutionEnd(id) {
      apply({ type: "tool_execution_end", id });
    },
    agentSettled(aborted, context) {
      // A settle for a run this session never saw, such as the previous session's run after `start`, reports
      // nothing: the elapsed time would be measured from a start that belongs to no run.
      if (!state.running) return;
      ctx = context;
      const elapsed = host.now() - state.startedAt;
      stopTimer();
      if (context.mode === "tui") {
        context.ui.setWorkingMessage();
        const title = doneTitle(elapsed, aborted || failed);
        if (title !== undefined) context.ui.setTitle(title);
      }
      host.appendWorked(elapsed);
      apply({ type: "agent_settled" });
    },
    shutdown(context) {
      reset();
      if (context.mode === "tui") context.ui.setWorkingMessage();
    },
  };
}
