import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type AgentSession, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import type { SideToolOptions } from "./agent.ts";
import { type BtwContext, type BtwHost, type BtwSession, createBtwSession } from "./session.ts";
import { BTW_ENTRY_TYPE, type StoredTurn } from "./thread.ts";

const theme = testTheme("dark");
initTheme("dark");

interface Notice {
  message: string;
  level: string;
}

/** A controllable stand-in for the side agent session `openSideSession` returns. */
interface FakeSide {
  prompts: string[];
  subscribers: ((event: unknown) => void)[];
  aborted: boolean;
  disposed: boolean;
  messages: { role: string }[];
  opened: (SideToolOptions | undefined)[];
  resolvePrompt(): void;
}

interface Harness {
  session: BtwSession;
  ctx: BtwContext;
  side: FakeSide;
  notified: Notice[];
  modes: boolean[];
  stored: StoredTurn[];
  editorText: string;
  setEditorText(text: string): void;
  inputHandler(data: string): unknown;
  drawerLines(width?: number): string[];
  renders(): number;
  listeners(): number;
  tickers(): number;
  restart(): void;
}

function harness(setup?: (dir: string) => void, branch: readonly unknown[] = []): Harness {
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-btw-"));
  setup?.(dir);
  const notified: Notice[] = [];
  const modes: boolean[] = [];
  const stored: StoredTurn[] = [];
  const prompts: string[] = [];
  const subscribers: ((event: unknown) => void)[] = [];
  const side: FakeSide = {
    prompts,
    subscribers,
    aborted: false,
    disposed: false,
    messages: [],
    opened: [],
    resolvePrompt: () => resolvePrompt?.(),
  };
  let resolvePrompt: (() => void) | undefined;
  const fakeSession = {
    subscribe: (subscriber: (event: unknown) => void) => {
      subscribers.push(subscriber);
      return () => {};
    },
    prompt: (text: string) => {
      prompts.push(text);
      return new Promise<void>((resolve) => {
        resolvePrompt = resolve;
      });
    },
    state: { messages: side.messages },
    abort: () => {
      side.aborted = true;
      resolvePrompt?.();
    },
    dispose: () => {
      side.disposed = true;
    },
  } as unknown as AgentSession;

  let editorText = "";
  let inputHandler: (data: string) => unknown = () => undefined;
  let widgetFactory: ((tui: TUI, widgetTheme: Theme) => object) | undefined;
  let listeners = 0;
  let tickers = 0;
  let renders = 0;
  const ctx = {
    mode: "tui",
    cwd: dir,
    model: { id: "test-model" },
    thinkingLevel: "off",
    modelRegistry: { find: () => undefined, getAvailable: () => [] },
    getSystemPrompt: () => "system prompt",
    sessionManager: {
      getEntries: () => [],
      getLeafId: () => "leaf-1",
      getBranch: () => branch,
    },
    ui: {
      notify: (message: string, level?: "info" | "warning" | "error") =>
        notified.push({ message, level: level ?? "info" }),
      custom: (async () => undefined) as unknown as BtwContext["ui"]["custom"],
      setWidget: (_key: string, content: unknown) => {
        widgetFactory = content as (tui: TUI, widgetTheme: Theme) => object;
      },
      onTerminalInput: (handler: (data: string) => unknown) => {
        inputHandler = handler;
        listeners += 1;
        return () => {
          listeners -= 1;
        };
      },
      getEditorText: () => editorText,
      setEditorText: (text: string) => {
        editorText = text;
      },
    },
  } as unknown as BtwContext;

  const host: BtwHost = {
    now: () => 10_000,
    emitBtwMode: (open) => modes.push(open),
    appendBtwEntry: (turn) => stored.push(turn),
    agentDir: () => dir,
    every: () => {
      tickers += 1;
      return () => {
        tickers -= 1;
      };
    },
    editorFocused: () => true,
    openSideSession: (_sideCtx, _seeded, tools) => {
      side.opened.push(tools);
      return Promise.resolve(fakeSession);
    },
  };

  const session = createBtwSession(host);
  session.start(ctx);

  const widgetTui = { terminal: { rows: 24 }, requestRender: () => renders++ } as unknown as TUI;
  let drawer: { render(w: number): string[] };
  const mount = (): void => {
    // Pi mounts the widget right after start; mounting here sets the tui the terminal-input handler needs.
    assert.ok(widgetFactory, "session.start did not mount the widget");
    drawer = widgetFactory(widgetTui, theme) as { render(w: number): string[] };
  };
  mount();
  const drawerLines = (width = 80): string[] => drawer.render(width).map((line) => stripTerminalSequences(line));

  return {
    session,
    ctx,
    side,
    notified,
    modes,
    stored,
    get editorText() {
      return editorText;
    },
    setEditorText: (text) => {
      editorText = text;
    },
    inputHandler: (data) => inputHandler(data),
    drawerLines,
    renders: () => renders,
    listeners: () => listeners,
    tickers: () => tickers,
    restart: () => {
      session.start(ctx);
      mount();
    },
  };
}

/** Lets the fire-and-forget `ask` reach its first await. */
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

function assistantAnswer(text: string) {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    usage: {
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 120,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

test("a question runs through pending to a stored turn", async () => {
  const h = harness();
  await h.session.runBtwCommand("what is pi?", h.ctx);
  await flush();

  assert.equal(h.side.prompts.length, 1);
  assert.match(h.side.prompts[0] ?? "", /what is pi\?/);
  assert.match(h.drawerLines().join("\n"), /what is pi\?/);
  assert.equal(h.modes.at(-1), true);

  h.side.messages.push({ role: "user" }, assistantAnswer("the answer"));
  h.side.resolvePrompt();
  await flush();

  assert.equal(h.stored.length, 1);
  assert.equal(h.side.disposed, true);
  assert.match(h.drawerLines().join("\n"), /the answer/);

  await h.session.runBtwCommand("and again?", h.ctx);
  await flush();
  assert.equal(h.side.prompts.length, 2);
});

test("esc stops the pending question and restores the draft", async () => {
  const h = harness();
  await h.session.runBtwCommand("what is pi?", h.ctx);
  await flush();

  assert.deepEqual(h.inputHandler("\x1b"), { consume: true });
  assert.equal(h.side.aborted, true);
  assert.equal(h.editorText, "what is pi?");
  assert.equal(h.stored.length, 0);

  h.side.messages.push({ role: "user" }, assistantAnswer("late answer"));
  h.side.resolvePrompt();
  await flush();
  assert.equal(h.stored.length, 0);
});

test("a second question while pending is refused", async () => {
  const h = harness();
  await h.session.runBtwCommand("first?", h.ctx);
  await flush();

  const result = h.session.input(
    { source: "interactive", text: "second?" } as Parameters<BtwSession["input"]>[0],
    h.ctx,
  );
  assert.deepEqual(result, { action: "handled" });
  assert.match(h.notified.at(-1)?.message ?? "", /still answering/);
  assert.equal(h.editorText, "second?");
  assert.equal(h.side.prompts.length, 1);
});

test("shutdown aborts the pending question", async () => {
  const h = harness();
  await h.session.runBtwCommand("first?", h.ctx);
  await flush();

  h.session.shutdown();
  assert.equal(h.side.aborted, true);
  assert.equal(h.modes.at(-1), false);

  h.side.messages.push({ role: "user" }, assistantAnswer("late"));
  h.side.resolvePrompt();
  await flush();
  assert.equal(h.stored.length, 0);
});

test("shutdown clears the session and a restart starts fresh", async () => {
  const h = harness();
  await h.session.runBtwCommand("first?", h.ctx);
  await flush();
  assert.equal(h.tickers(), 1);
  assert.equal(h.listeners(), 1);

  h.session.shutdown();
  assert.equal(h.side.aborted, true);
  assert.equal(h.modes.at(-1), false);
  assert.equal(h.tickers(), 0);
  assert.equal(h.listeners(), 0);
  assert.deepEqual(h.drawerLines(), [], "the drawer is closed");

  // The aborted question resolves after the shutdown; nothing of it may reach the screen.
  const renders = h.renders();
  h.side.messages.push({ role: "user" }, assistantAnswer("late answer"));
  h.side.resolvePrompt();
  await flush();
  assert.equal(h.stored.length, 0);
  assert.equal(h.renders(), renders);

  h.restart();
  assert.equal(h.tickers(), 0);
  assert.equal(h.listeners(), 1);
  await h.session.runBtwCommand("second?", h.ctx);
  await flush();
  assert.equal(h.side.prompts.length, 2);
  const lines = h.drawerLines().join("\n");
  assert.match(lines, /second\?/);
  assert.doesNotMatch(lines, /first\?|late answer/);
});

test("start restores the turns stored in the session branch", async () => {
  const saved = {
    thread: { id: "btw-old", anchorEntryId: "leaf-1", anchorTurns: 0 },
    turn: { text: "old text", question: "old?", messages: [], askedAt: 1, durationMs: 2, denied: [] },
  };
  const h = harness(undefined, [
    { type: "custom", customType: BTW_ENTRY_TYPE, data: saved },
    { type: "custom", customType: BTW_ENTRY_TYPE, data: { junk: true } },
    { type: "custom", customType: "pi-tune-elsewhere", data: {} },
  ]);
  assert.equal(h.notified.length, 1);
  assert.match(h.notified[0].message, /Skipped 1 btw entry saved by an older pi-tune build/);

  await h.session.runBtwCommand("new?", h.ctx);
  await flush();
  // The saved thread takes number 1, so the question asked now is number 2.
  assert.match(h.drawerLines().join("\n"), /btw #2/);
});

test("start reports an unreadable rules file once instead of throwing", async () => {
  const h = harness((dir) => mkdirSync(join(dir, "pi-tune.json")));
  assert.equal(h.notified.length, 1);
  assert.equal(h.notified[0].level, "warning");
  assert.match(h.notified[0].message, /btw tools use the defaults: .*pi-tune\.json could not be read/);

  await h.session.runBtwCommand("what is pi?", h.ctx);
  await flush();
  assert.equal(h.notified.length, 1);
  assert.equal(h.side.prompts.length, 1);
});
