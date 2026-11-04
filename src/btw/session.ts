import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Message } from "@earendil-works/pi-ai";
import type { AgentSession, InputEvent, InputEventResult, MessageStartEvent } from "@earendil-works/pi-coding-agent";
import { buildSessionContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import type { SideParentContext, SideToolOptions } from "./agent.ts";
import { Drawer, type DrawerView, SPINNER_INTERVAL_MS } from "./drawer.ts";
import { activityLabel, streamPhase } from "./render.ts";
import { allowedCalls, type BtwRules, DEFAULT_RULES, loadBtwRules } from "./rules.ts";
import { detectSandbox, type SandboxKind } from "./sandbox.ts";
import {
  BTW_ENTRY_TYPE,
  type BtwThread,
  type BtwTurn,
  composeTurnText,
  countUserTurns,
  foldThreads,
  messageText,
  producedMessages,
  SIDE_THREAD_ADDENDUM,
  type StoredTurn,
  staleNotice,
  storedTurn,
  threadMessages,
  toolsNotice,
} from "./thread.ts";
import { NEW_THREAD, ThreadList, threadItems } from "./thread-list.ts";

const WIDGET_KEY = "pi-tune-btw";

/** The question being answered: shown in the drawer as it streams, stopped by esc. */
interface Pending {
  threadId: string;
  question: string;
  answer: string;
  /** `Working`, `Thinking`, `Responding`, or the tool call that runs. */
  phase: string;
  /** The phase names a call the rules just refused. */
  blocked: boolean;
  denied: string[];
  startedAt: number;
  stopped: boolean;
  session?: AgentSession;
}

/** What the btw session reads from the running Pi instance; injected so tests can fake it. */
export interface BtwHost {
  now(): number;
  /** `pi.events.emit(BTW_MODE_CHANNEL, open)`. */
  emitBtwMode(open: boolean): void;
  /** `pi.appendEntry(BTW_ENTRY_TYPE, stored)` — persists a finished turn. */
  appendBtwEntry(stored: StoredTurn): void;
  /** `getAgentDir()`: where `pi-tune.json` lives. */
  agentDir(): string;
  /** Runs `callback` every `ms` until the returned cancel is called; `setInterval` in the extension. */
  every(callback: () => void, ms: number): () => void;
  /** Whether Pi's editor has focus; `editorHasFocus` in the extension (a Pi-internals probe). */
  editorFocused(tui: TUI): boolean | Error;
  /** Opens the side agent session; `openSideSession` in the extension. */
  openSideSession(
    ctx: SideParentContext,
    seeded: readonly (AgentMessage | Message)[],
    tools: SideToolOptions,
  ): Promise<AgentSession>;
}

/** The part of Pi's `ExtensionContext` the btw session uses. */
export interface BtwContext {
  mode: ExtensionContext["mode"];
  cwd: string;
  model: ExtensionContext["model"];
  thinkingLevel?: ExtensionContext["thinkingLevel"];
  modelRegistry: ExtensionContext["modelRegistry"];
  getSystemPrompt(): string;
  sessionManager: Pick<ExtensionContext["sessionManager"], "getEntries" | "getLeafId" | "getBranch">;
  ui: Pick<
    ExtensionContext["ui"],
    "notify" | "custom" | "setWidget" | "onTerminalInput" | "getEditorText" | "setEditorText"
  >;
}

export interface BtwSession {
  start(ctx: BtwContext): void;
  sessionTree(ctx: BtwContext): void;
  shutdown(): void;
  messageStart(event: MessageStartEvent): void;
  input(event: InputEvent, ctx: BtwContext): InputEventResult | undefined;
  /** The `/btw` command's handler body. */
  runBtwCommand(args: string, ctx: BtwContext): Promise<void>;
}

export function createBtwSession(host: BtwHost): BtwSession {
  let threads: BtwThread[] = [];
  /** btw mode: the drawer is open and Enter sends the editor's text to the displayed thread. */
  let open = false;
  /** The thread in the drawer; undefined on a new thread whose first question is not asked yet. */
  let displayedId: string | undefined;
  let pending: Pending | undefined;
  /** User turns the main session has now; kept current by events so the drawer does no work per frame. */
  let mainTurns = 0;
  let revision = 0;
  let drawer: Drawer | undefined;
  let tui: TUI | undefined;
  let stopRefresh: (() => void) | undefined;
  let stopListening: (() => void) | undefined;
  let rules: BtwRules = DEFAULT_RULES;
  let rulesPath = "pi-tune.json";
  let rulesProblem: string | undefined;
  /** Detected on the first allowed bash command, then kept for the process. */
  let sandbox: SandboxKind | Error | undefined;
  let warnedUnsandboxed = false;

  const displayed = (): BtwThread | null => threads.find((thread) => thread.id === displayedId) ?? null;

  function view(): DrawerView {
    const thread = displayed();
    const running = pending && pending.threadId === thread?.id ? pending : undefined;
    return {
      open,
      thread,
      number: thread ? threads.indexOf(thread) + 1 : threads.length + 1,
      mainTurns,
      ...(running
        ? {
            pending: {
              question: running.question,
              answer: running.answer,
              phase: running.phase,
              blocked: running.blocked,
              startedAt: running.startedAt,
            },
          }
        : {}),
      revision,
    };
  }

  function changed(): void {
    revision += 1;
    tui?.requestRender();
  }

  function setOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    host.emitBtwMode(open);
    changed();
  }

  /** Opens the drawer on a thread, or on a new one; threads that never got an answer are dropped on the way. */
  function show(threadId: string | undefined): void {
    threads = threads.filter((thread) => thread.turns.length > 0 || thread.id === pending?.threadId);
    displayedId = threadId;
    drawer?.follow();
    setOpen(true);
    changed();
  }

  function snapshot(ctx: BtwContext, anchorEntryId: string | null) {
    const entries = ctx.sessionManager.getEntries();
    return buildSessionContext(entries, anchorEntryId ?? ctx.sessionManager.getLeafId()).messages;
  }

  function restore(ctx: BtwContext): void {
    const stored = ctx.sessionManager
      .getBranch()
      .filter((entry) => entry.type === "custom" && entry.customType === BTW_ENTRY_TYPE)
      .map((entry) => (entry as unknown as { data?: unknown }).data);
    const folded = foldThreads(stored);
    threads = folded.threads;
    if (folded.skipped > 0) {
      ctx.ui.notify(
        `Skipped ${folded.skipped} btw ${folded.skipped === 1 ? "entry" : "entries"} saved by an older pi-tune build.`,
        "warning",
      );
    }
    mainTurns = countUserTurns(snapshot(ctx, null));
  }

  function startTicker(): void {
    stopRefresh ??= host.every(() => tui?.requestRender(), SPINNER_INTERVAL_MS);
  }

  function stopTicker(): void {
    stopRefresh?.();
    stopRefresh = undefined;
  }

  /** Read on every question, so an edited `pi-tune.json` applies without `/reload`; a problem warns once until it changes. */
  function loadRules(ctx: BtwContext): void {
    const load = loadBtwRules(rulesPath);
    rules = load.rules;
    if (load.problem && load.problem !== rulesProblem) ctx.ui.notify(load.problem, "warning");
    rulesProblem = load.problem;
  }

  /** A question that did not get its answer goes back into the empty editor, ready to send again. */
  function restoreDraft(ctx: BtwContext, text: string): void {
    if (ctx.ui.getEditorText() === "") ctx.ui.setEditorText(text);
  }

  async function ask(ctx: BtwContext, question: string): Promise<void> {
    if (!ctx.model) throw new Error("No active model to answer the side question.");
    loadRules(ctx);
    let thread = displayed();
    if (!thread) {
      thread = {
        id: `btw-${host.now().toString(36)}`,
        anchorEntryId: ctx.sessionManager.getLeafId() ?? "",
        anchorTurns: mainTurns,
        turns: [],
      };
      threads = [...threads, thread];
      displayedId = thread.id;
    }
    // The tool rules ride along the first question, and again only when they changed since the model was told.
    const tools = toolsNotice(allowedCalls(rules), rules.deny, false);
    const told = thread.turns
      .map((turn) => turn.announcedTools)
      .filter((announced) => announced !== undefined)
      .at(-1);
    const announce = thread.turns.length === 0 || told !== tools;
    const text = composeTurnText(question, {
      addendum: thread.turns.length === 0 ? SIDE_THREAD_ADDENDUM : undefined,
      tools: announce ? toolsNotice(allowedCalls(rules), rules.deny, thread.turns.length > 0) : undefined,
      notice: staleNotice(thread.anchorTurns, mainTurns),
    });
    const seeded = [...snapshot(ctx, thread.anchorEntryId || null), ...threadMessages(thread)];

    const current: Pending = {
      threadId: thread.id,
      question,
      answer: "",
      phase: "Working",
      blocked: false,
      denied: [],
      startedAt: host.now(),
      stopped: false,
    };
    pending = current;
    drawer?.follow();
    startTicker();
    changed();

    let session: AgentSession | undefined;
    let unsubscribe = () => {};
    try {
      session = await host.openSideSession(ctx, seeded, {
        rules,
        rulesPath,
        sandbox: () => {
          sandbox ??= detectSandbox();
          return sandbox;
        },
        onDenied: (label) => {
          if (!current.denied.includes(label)) current.denied.push(label);
          current.phase = label;
          current.blocked = true;
          changed();
        },
        onUnsandboxed: (problem) => {
          if (warnedUnsandboxed) return;
          warnedUnsandboxed = true;
          ctx.ui.notify(`btw runs allowed bash commands without a sandbox: ${problem.message}`, "warning");
        },
      });
      current.session = session;
      if (current.stopped) return;
      const streaming = session;
      unsubscribe = streaming.subscribe((event) => {
        if (event.type === "message_update" && event.message.role === "assistant") {
          current.answer = messageText(event.message);
          const phase = streamPhase(event.assistantMessageEvent.type);
          if (phase) {
            current.phase = phase;
            current.blocked = false;
          }
        } else if (event.type === "tool_execution_start") {
          current.phase = activityLabel(event.toolName, event.args);
          current.blocked = false;
        } else if (event.type === "tool_execution_end") {
          // A refused call stays on screen until the model's next phase replaces it.
          if (!current.blocked) current.phase = "Working";
        } else {
          return;
        }
        changed();
      });
      await streaming.prompt(text, { source: "extension" });
      if (current.stopped) return;
      const messages = producedMessages(streaming.state.messages);
      const reply = messages.at(-1);
      if (reply?.role !== "assistant") throw new Error("The side question finished without an answer.");
      if (reply.stopReason === "error") throw new Error(reply.errorMessage || "The side question failed.");
      const turn: BtwTurn = {
        text,
        question,
        messages,
        askedAt: current.startedAt,
        durationMs: host.now() - current.startedAt,
        denied: current.denied,
        ...(announce ? { announcedTools: tools } : {}),
      };
      thread.turns.push(turn);
      host.appendBtwEntry(storedTurn(thread, turn));
    } finally {
      unsubscribe();
      session?.dispose();
      if (pending === current) pending = undefined;
      // A question stopped by esc may finish after the next one started; that one keeps its spinner.
      if (!pending) stopTicker();
      changed();
    }
  }

  function submit(ctx: BtwContext, question: string): void {
    void ask(ctx, question).catch((error: unknown) => {
      restoreDraft(ctx, question);
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    });
  }

  function stop(ctx: BtwContext, running: Pending): void {
    running.stopped = true;
    void running.session?.abort();
    if (pending === running) pending = undefined;
    stopTicker();
    restoreDraft(ctx, running.question);
    changed();
  }

  function pickThread(ctx: BtwContext): Promise<string | undefined> {
    return ctx.ui.custom<string | undefined>(
      (listTui, theme, _keybindings, done) =>
        new ThreadList({
          items: threadItems(threads, mainTurns),
          // Opening the list is for continuing a thread; `/btw <question>` starts a new one.
          selected: displayedId ?? threads.filter((thread) => thread.turns.length > 0).at(-1)?.id ?? NEW_THREAD,
          tui: listTui,
          theme,
          done,
        }),
    );
  }

  function mountWidget(ctx: BtwContext): void {
    ctx.ui.setWidget(
      WIDGET_KEY,
      (widgetTui, theme) => {
        tui = widgetTui;
        drawer = new Drawer({ view, theme, terminalRows: () => widgetTui.terminal.rows });
        return drawer;
      },
      { placement: "aboveEditor" },
    );
  }

  /** Esc and shift+↑↓ act on the drawer only while the editor has focus, so Pi's dialogs keep their own keys. */
  function listen(ctx: BtwContext): void {
    stopListening?.();
    let warned = false;
    stopListening = ctx.ui.onTerminalInput((data) => {
      if (!open || !tui) return undefined;
      const focused = host.editorFocused(tui);
      if (focused instanceof Error) {
        if (!warned) ctx.ui.notify(`pi-tune btw: ${focused.message}; esc and shift+↑↓ stay with Pi.`, "warning");
        warned = true;
        return undefined;
      }
      if (!focused) return undefined;
      if (matchesKey(data, "escape")) {
        if (ctx.ui.getEditorText() !== "") return undefined;
        const running = view().pending ? pending : undefined;
        if (running) stop(ctx, running);
        else setOpen(false);
        return { consume: true };
      }
      if (matchesKey(data, "shift+up") || matchesKey(data, "shift+down")) {
        drawer?.page(matchesKey(data, "shift+up") ? -1 : 1);
        tui?.requestRender();
        return { consume: true };
      }
      return undefined;
    });
  }

  return {
    start(ctx) {
      open = false;
      displayedId = undefined;
      pending = undefined;
      host.emitBtwMode(false);
      rulesPath = join(host.agentDir(), "pi-tune.json");
      rulesProblem = undefined;
      loadRules(ctx);
      restore(ctx);
      if (ctx.mode !== "tui") return;
      mountWidget(ctx);
      listen(ctx);
    },
    sessionTree(ctx) {
      restore(ctx);
      if (displayedId !== undefined && !displayed()) setOpen(false);
      changed();
    },
    shutdown() {
      if (pending) {
        pending.stopped = true;
        void pending.session?.abort();
      }
      pending = undefined;
      stopTicker();
      stopListening?.();
      stopListening = undefined;
      open = false;
      host.emitBtwMode(false);
    },
    messageStart(event) {
      if ((event.message as { role?: string }).role !== "user") return;
      mainTurns += 1;
      if (open) changed();
    },
    input(event, ctx) {
      if (!open || event.source !== "interactive") return { action: "continue" };
      const question = event.text.trim();
      if (question === "") return { action: "continue" };
      if (pending) {
        restoreDraft(ctx, event.text);
        ctx.ui.notify("A side question is still answering. Esc stops it.", "warning");
        return { action: "handled" };
      }
      if (event.images?.length) ctx.ui.notify("Images are not sent to a btw thread.", "warning");
      submit(ctx, question);
      return { action: "handled" };
    },
    async runBtwCommand(args, ctx) {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("btw needs the interactive TUI.", "warning");
        return;
      }
      const question = args.trim();
      if (question.length > 0) {
        if (pending) {
          restoreDraft(ctx, `/btw ${question}`);
          ctx.ui.notify("A side question is still answering. Esc stops it.", "warning");
          return;
        }
        show(undefined);
        submit(ctx, question);
        return;
      }
      const asked = threads.some((thread) => thread.turns.length > 0);
      const choice = asked ? await pickThread(ctx) : NEW_THREAD;
      if (choice === undefined) return;
      show(choice === NEW_THREAD ? undefined : choice);
    },
  };
}
