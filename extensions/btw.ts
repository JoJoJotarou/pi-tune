import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  buildSessionContext,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { openSideSession } from "../src/btw/child.ts";
import { drawerMaxHeight, renderBtw } from "../src/btw/render.ts";
import {
  BTW_ENTRY_TYPE,
  type BtwThread,
  composeTurnText,
  countUserTurns,
  SIDE_THREAD_ADDENDUM,
  staleNotice,
  threadMessages,
} from "../src/btw/thread.ts";

const WIDGET_KEY = "pi-tune-btw";
const COMPOSE_SHORTCUT = "ctrl+shift+b";
const EXPAND_SHORTCUT = "ctrl+shift+e";

interface StoredThreads {
  threads: BtwThread[];
  activeId?: string;
}

type Notify = (message: string, level?: "info" | "warning" | "error") => void;

function lastAssistant(session: { state: { messages: readonly { role: string }[] } }): AssistantMessage | undefined {
  for (let index = session.state.messages.length - 1; index >= 0; index--) {
    const message = session.state.messages[index];
    if (message.role === "assistant") return message as AssistantMessage;
  }
  return undefined;
}

export default function btwExtension(pi: ExtensionAPI) {
  let threads: BtwThread[] = [];
  let activeId: string | undefined;
  let composing = false;
  let expanded = false;
  /** User turns the main session has now; kept current by events so the drawer does no work per frame. */
  let mainTurns = 0;
  let theme: Theme | undefined;
  let requestRender: (() => void) | undefined;
  let terminalRows = 40;
  let notify: Notify = () => {};

  const active = (): BtwThread | null => threads.find((thread) => thread.id === activeId) ?? null;

  function snapshot(ctx: ExtensionContext, anchorEntryId: string | null) {
    const entries = ctx.sessionManager.getEntries();
    return buildSessionContext(entries, anchorEntryId ?? ctx.sessionManager.getLeafId()).messages;
  }

  function store(): void {
    pi.appendEntry(BTW_ENTRY_TYPE, { threads, activeId } satisfies StoredThreads);
  }

  function paint(): void {
    requestRender?.();
  }

  /** Keeps "btw" visible in the footer while the composer sends to the side thread instead of the main one. */
  function refreshStatus(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    ctx.ui.setStatus("pi-tune-btw", composing ? "btw asking" : undefined);
  }

  function threadLabel(thread: BtwThread): string {
    const behind = mainTurns - thread.anchorTurns;
    const state = behind > 0 ? `main +${behind}` : "in sync";
    const last = thread.turns.at(-1)?.question ?? "(empty)";
    return `${thread.id} · @turn ${thread.anchorTurns} · ${state} · ${last.slice(0, 48)}`;
  }

  async function ask(ctx: ExtensionContext, question: string): Promise<void> {
    if (!ctx.model) {
      notify("No active model to answer the side question.", "error");
      return;
    }

    if (!active()) {
      const anchorEntryId = ctx.sessionManager.getLeafId();
      threads = [
        ...threads,
        { id: `btw-${Date.now().toString(36)}`, anchorEntryId: anchorEntryId ?? "", anchorTurns: mainTurns, turns: [] },
      ];
      activeId = threads[threads.length - 1].id;
    }
    const thread = active();
    if (!thread) return;

    const anchored = snapshot(ctx, thread.anchorEntryId || ctx.sessionManager.getLeafId());
    const missing = staleNotice(thread.anchorTurns, mainTurns);
    const text = composeTurnText(question, {
      addendum: thread.turns.length === 0 ? SIDE_THREAD_ADDENDUM : undefined,
      notice: missing,
    });

    const session = await openSideSession(pi, ctx, [...anchored, ...threadMessages(thread)]);
    try {
      await session.prompt(text, { source: "extension" });
      const message = lastAssistant(session);
      if (!message) throw new Error("The side question finished without an answer.");
      if (message.stopReason === "error") throw new Error(message.errorMessage || "The side question failed.");
      thread.turns.push({ text, question, message, askedAt: Date.now() });
      store();
    } finally {
      session.dispose();
      paint();
    }
  }

  function startThread(ctx: ExtensionContext): void {
    const anchorEntryId = ctx.sessionManager.getLeafId();
    threads = [
      ...threads,
      { id: `btw-${Date.now().toString(36)}`, anchorEntryId: anchorEntryId ?? "", anchorTurns: mainTurns, turns: [] },
    ];
    activeId = threads[threads.length - 1].id;
    store();
    paint();
  }

  function mountWidget(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget(
      WIDGET_KEY,
      (tui, widgetTheme) => {
        theme = widgetTheme;
        terminalRows = tui.terminal.rows;
        requestRender = () => tui.requestRender();
        return {
          render(width: number) {
            if (!theme) return [];
            if (!active() && !composing) return [];
            terminalRows = tui.terminal.rows;
            return renderBtw({
              thread: active(),
              mainTurns,
              composing,
              maxHeight: drawerMaxHeight(terminalRows, expanded),
              width,
              theme,
            });
          },
          invalidate() {},
        };
      },
      { placement: "aboveEditor" },
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    notify = (message, level = "info") => ctx.ui.notify(message, level);
    threads = [];
    activeId = undefined;
    composing = false;
    mainTurns = 0;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === BTW_ENTRY_TYPE) {
        const stored = (entry as unknown as { data?: StoredThreads }).data;
        if (stored?.threads) {
          threads = stored.threads;
          activeId = stored.activeId;
        }
      }
    }
    mainTurns = countUserTurns(snapshot(ctx, null));
    mountWidget(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    threads = [];
    activeId = undefined;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === BTW_ENTRY_TYPE) {
        const stored = (entry as unknown as { data?: StoredThreads }).data;
        if (stored?.threads) {
          threads = stored.threads;
          activeId = stored.activeId;
        }
      }
    }
    mainTurns = countUserTurns(snapshot(ctx, null));
    paint();
  });

  pi.on("message_start", async (event) => {
    if ((event.message as { role?: string }).role !== "user") return;
    mainTurns += 1;
    paint();
  });

  pi.on("input", async (event, ctx) => {
    const text = event.text.trim();
    if (!composing || text.length === 0 || text.startsWith("/")) return { action: "continue" };
    void ask(ctx as ExtensionContext, text).catch((error: unknown) => {
      notify(error instanceof Error ? error.message : String(error), "error");
    });
    return { action: "handled" };
  });

  pi.registerShortcut(COMPOSE_SHORTCUT, {
    description: "Ask a btw side question",
    handler: async (ctx) => {
      composing = !composing;
      paint();
      if (ctx.mode === "tui")
        ctx.ui.notify(composing ? "btw: type a side question, Enter sends it." : "btw: main session again.", "info");
    },
  });

  pi.registerShortcut(EXPAND_SHORTCUT, {
    description: "Expand the btw drawer",
    handler: async () => {
      expanded = !expanded;
      paint();
    },
  });

  pi.registerCommand("btw", {
    description: "Ask a side question without touching the main conversation",
    handler: async (args, ctx) => {
      const question = args.trim();
      if (question.length > 0) {
        await ask(ctx, question).catch((error: unknown) => {
          notify(error instanceof Error ? error.message : String(error), "error");
        });
        return;
      }
      composing = !composing;
      paint();
      refreshStatus(ctx);
      ctx.ui.notify(composing ? "btw: type a side question, Enter sends it." : "btw: main session again.", "info");
    },
  });

  pi.registerCommand("btw:new", {
    description: "Start a fresh btw thread anchored at the current turn",
    handler: async (_args, ctx) => {
      startThread(ctx);
      composing = true;
      paint();
      refreshStatus(ctx);
      ctx.ui.notify("btw: new thread. Type a question, Enter sends it.", "info");
    },
  });

  pi.registerCommand("btw:threads", {
    description: "Switch to another btw thread",
    handler: async (_args, ctx) => {
      if (threads.length === 0) {
        ctx.ui.notify("No btw threads yet. Run /btw <question>.", "warning");
        return;
      }
      const choice = await ctx.ui.select("btw threads", threads.map(threadLabel));
      if (!choice) return;
      const picked = threads.find((thread) => threadLabel(thread) === choice);
      if (!picked) return;
      activeId = picked.id;
      store();
      paint();
    },
  });
}
