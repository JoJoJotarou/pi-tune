import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type AgentSession, initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import type { SideToolOptions } from "./agent.ts";
import { type BtwContext, type BtwHost, type BtwSession, createBtwSession } from "./session.ts";
import type { StoredTurn } from "./thread.ts";

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
}

function harness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-btw-"));
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
      getBranch: () => [],
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
        return () => {};
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
    every: () => () => {},
    editorFocused: () => true,
    openSideSession: (_sideCtx, _seeded, tools) => {
      side.opened.push(tools);
      return Promise.resolve(fakeSession);
    },
  };

  const session = createBtwSession(host);
  session.start(ctx);

  // Pi mounts the widget right after start; mounting here sets the tui the terminal-input handler needs.
  assert.ok(widgetFactory, "session.start did not mount the widget");
  const widgetTui = { terminal: { rows: 24 }, requestRender: () => {} } as unknown as TUI;
  const drawer = widgetFactory(widgetTui, theme) as { render(w: number): string[] };
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
