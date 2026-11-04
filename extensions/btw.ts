import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type AgentSession,
  buildSessionContext,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, type TUI } from "@earendil-works/pi-tui";
import { openSideSession } from "../src/btw/child.ts";
import { Drawer, type DrawerView, SPINNER_INTERVAL_MS } from "../src/btw/drawer.ts";
import {
  BTW_ENTRY_TYPE,
  type BtwThread,
  composeTurnText,
  countUserTurns,
  messageText,
  SIDE_THREAD_ADDENDUM,
  staleNotice,
  threadMessages,
} from "../src/btw/thread.ts";
import { NEW_THREAD, ThreadList, threadItems } from "../src/btw/thread-list.ts";
import { editorHasFocus } from "../src/internals/focus.ts";
import { BTW_MODE_CHANNEL } from "../src/shared/btw.ts";

const WIDGET_KEY = "pi-tune-btw";

interface StoredThreads {
  threads: BtwThread[];
}

/** The question being answered: shown in the drawer as it streams, stopped by esc. */
interface Pending {
  threadId: string;
  question: string;
  answer: string;
  startedAt: number;
  stopped: boolean;
  session?: AgentSession;
}

function lastAssistant(messages: readonly { role: string }[]): AssistantMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "assistant") return message as AssistantMessage;
  }
  return undefined;
}

export default function btwExtension(pi: ExtensionAPI) {
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
  let ticker: ReturnType<typeof setInterval> | undefined;
  let stopListening: (() => void) | undefined;

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
        ? { pending: { question: running.question, answer: running.answer, startedAt: running.startedAt } }
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
    pi.events.emit(BTW_MODE_CHANNEL, open);
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

  function snapshot(ctx: ExtensionContext, anchorEntryId: string | null) {
    const entries = ctx.sessionManager.getEntries();
    return buildSessionContext(entries, anchorEntryId ?? ctx.sessionManager.getLeafId()).messages;
  }

  function restore(ctx: ExtensionContext): void {
    threads = [];
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === BTW_ENTRY_TYPE) {
        const stored = (entry as unknown as { data?: StoredThreads }).data;
        if (stored?.threads) threads = stored.threads;
      }
    }
    mainTurns = countUserTurns(snapshot(ctx, null));
  }

  function persist(): void {
    pi.appendEntry(BTW_ENTRY_TYPE, {
      threads: threads.filter((thread) => thread.turns.length > 0),
    } satisfies StoredThreads);
  }

  function startTicker(): void {
    ticker ??= setInterval(() => tui?.requestRender(), SPINNER_INTERVAL_MS);
  }

  function stopTicker(): void {
    if (ticker !== undefined) clearInterval(ticker);
    ticker = undefined;
  }

  /** A question that did not get its answer goes back into the empty editor, ready to send again. */
  function restoreDraft(ctx: ExtensionContext, text: string): void {
    if (ctx.ui.getEditorText() === "") ctx.ui.setEditorText(text);
  }

  async function ask(ctx: ExtensionContext, question: string): Promise<void> {
    if (!ctx.model) throw new Error("No active model to answer the side question.");
    let thread = displayed();
    if (!thread) {
      thread = {
        id: `btw-${Date.now().toString(36)}`,
        anchorEntryId: ctx.sessionManager.getLeafId() ?? "",
        anchorTurns: mainTurns,
        turns: [],
      };
      threads = [...threads, thread];
      displayedId = thread.id;
    }
    const text = composeTurnText(question, {
      addendum: thread.turns.length === 0 ? SIDE_THREAD_ADDENDUM : undefined,
      notice: staleNotice(thread.anchorTurns, mainTurns),
    });
    const seeded = [...snapshot(ctx, thread.anchorEntryId || null), ...threadMessages(thread)];

    const current: Pending = { threadId: thread.id, question, answer: "", startedAt: Date.now(), stopped: false };
    pending = current;
    drawer?.follow();
    startTicker();
    changed();

    let session: AgentSession | undefined;
    let unsubscribe = () => {};
    try {
      session = await openSideSession(pi, ctx, seeded);
      current.session = session;
      if (current.stopped) return;
      const streaming = session;
      unsubscribe = streaming.subscribe((event) => {
        if (event.type !== "message_update" || event.message.role !== "assistant") return;
        current.answer = messageText(event.message);
        changed();
      });
      await streaming.prompt(text, { source: "extension" });
      if (current.stopped) return;
      const message = lastAssistant(streaming.state.messages);
      if (!message) throw new Error("The side question finished without an answer.");
      if (message.stopReason === "error") throw new Error(message.errorMessage || "The side question failed.");
      thread.turns.push({
        text,
        question,
        message,
        askedAt: current.startedAt,
        durationMs: Date.now() - current.startedAt,
      });
      persist();
    } finally {
      unsubscribe();
      session?.dispose();
      if (pending === current) pending = undefined;
      // A question stopped by esc may finish after the next one started; that one keeps its spinner.
      if (!pending) stopTicker();
      changed();
    }
  }

  function submit(ctx: ExtensionContext, question: string): void {
    void ask(ctx, question).catch((error: unknown) => {
      restoreDraft(ctx, question);
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    });
  }

  function stop(ctx: ExtensionContext, running: Pending): void {
    running.stopped = true;
    void running.session?.abort();
    if (pending === running) pending = undefined;
    stopTicker();
    restoreDraft(ctx, running.question);
    changed();
  }

  function pickThread(ctx: ExtensionContext): Promise<string | undefined> {
    return ctx.ui.custom<string | undefined>(
      (listTui, theme, _keybindings, done) =>
        new ThreadList({
          items: threadItems(threads, mainTurns),
          selected: displayedId ?? NEW_THREAD,
          tui: listTui,
          theme,
          done,
        }),
    );
  }

  function mountWidget(ctx: ExtensionContext): void {
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
  function listen(ctx: ExtensionContext): void {
    stopListening?.();
    let warned = false;
    stopListening = ctx.ui.onTerminalInput((data) => {
      if (!open || !tui) return undefined;
      const focused = editorHasFocus(tui);
      if (focused instanceof Error) {
        if (!warned) ctx.ui.notify(focused.message, "warning");
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

  pi.on("session_start", async (_event, ctx) => {
    open = false;
    displayedId = undefined;
    pending = undefined;
    pi.events.emit(BTW_MODE_CHANNEL, false);
    restore(ctx);
    if (ctx.mode !== "tui") return;
    mountWidget(ctx);
    listen(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    restore(ctx);
    if (displayedId !== undefined && !displayed()) setOpen(false);
    changed();
  });

  pi.on("session_shutdown", async () => {
    if (pending) {
      pending.stopped = true;
      void pending.session?.abort();
    }
    pending = undefined;
    stopTicker();
    stopListening?.();
    stopListening = undefined;
    open = false;
    pi.events.emit(BTW_MODE_CHANNEL, false);
  });

  pi.on("message_start", async (event) => {
    if ((event.message as { role?: string }).role !== "user") return;
    mainTurns += 1;
    if (open) changed();
  });

  pi.on("input", async (event, ctx) => {
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
  });

  pi.registerCommand("btw", {
    description: "Ask a side question in a new thread, or pick a thread to continue",
    handler: async (args, ctx) => {
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
  });
}
