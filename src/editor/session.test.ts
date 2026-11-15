import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { createEditorSession, type EditorContext, type EditorHost, type EditorSession } from "./session.ts";
import type { TuneEditor } from "./tune-editor.ts";

interface Notice {
  message: string;
  level: string;
}

/** Pi asks the session for its editor; the test mounts it to reach the callbacks the session wired. */
type EditorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => TuneEditor;

interface Harness {
  session: EditorSession;
  dir: string;
  notified: Notice[];
  ctx: EditorContext;
  factories: EditorFactory[];
}

function makeContext(
  dir: string,
  mode: EditorContext["mode"],
): { ctx: EditorContext; notified: Notice[]; factories: EditorFactory[] } {
  const notified: Notice[] = [];
  const factories: EditorFactory[] = [];
  const models = [{ provider: "anthropic", id: "claude" }];
  const ctx = {
    mode,
    model: undefined,
    modelRegistry: {
      find: () => undefined,
      getAvailable: () => models,
    },
    cwd: dir,
    sessionManager: { getBranch: () => [] },
    ui: {
      notify: (message: string, level?: "info" | "warning" | "error") =>
        notified.push({ message, level: level ?? "info" }),
      custom: (() => Promise.resolve(undefined)) as unknown as EditorContext["ui"]["custom"],
      setEditorComponent: (factory: EditorFactory) => {
        factories.push(factory);
      },
      theme: testTheme("dark"),
    },
  } as unknown as EditorContext;
  return { ctx, notified, factories };
}

function harness(config: string | undefined, setup?: (dir: string) => void): Harness {
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-editor-"));
  if (config !== undefined) writeFileSync(join(dir, "pi-tune.json"), config);
  setup?.(dir);
  const { ctx, notified, factories } = makeContext(dir, "tui");
  const host: EditorHost = {
    settings: () => ({ editorPaddingX: 2, autocompleteMaxVisible: 5 }),
    agentDir: () => dir,
    now: () => 1_000,
    emitStash: () => {},
    emitReady: () => {},
  };
  const session = createEditorSession(host);
  session.start(ctx);
  return { session, dir, notified, ctx, factories };
}

/** The editor Pi would mount for this context, wired by the session's factory. */
function mountEditor(h: Harness): TuneEditor {
  const factory = h.factories[0];
  assert.ok(factory, "the session registered no editor");
  const tui = { requestRender() {}, terminal: { rows: 30, cols: 100 } } as unknown as TUI;
  const editorTheme = { borderColor: (text: string) => text, selectList: {} } as EditorTheme;
  return factory(tui, editorTheme, { matches: () => false } as unknown as KeybindingsManager);
}

test("start reports a broken settings file once", () => {
  const h = harness("{ not json");
  assert.equal(h.notified.length, 1);
  assert.equal(h.notified[0].level, "warning");
  assert.match(h.notified[0].message, /is not valid JSON/);
});

test("start reports an unreadable settings file once instead of throwing", () => {
  const h = harness(undefined, (dir) => mkdirSync(join(dir, "pi-tune.json")));
  assert.equal(h.notified.length, 1);
  assert.equal(h.notified[0].level, "warning");
  assert.match(h.notified[0].message, /pi-tune\.json could not be read/);
});

test("/suggest on and off save the file and report the state", async () => {
  const h = harness('{"suggest":{"enabled":false}}');
  await h.session.runSuggestCommand("on", h.ctx);
  assert.equal(h.notified.at(-1)?.level, "info");
  assert.match(h.notified.at(-1)?.message ?? "", /Next-step suggestions on · session model · careful/);
  assert.match(readFileSync(join(h.dir, "pi-tune.json"), "utf8"), /"enabled": true/);

  await h.session.runSuggestCommand("off", h.ctx);
  assert.match(h.notified.at(-1)?.message ?? "", /Next-step suggestions off/);
  assert.match(readFileSync(join(h.dir, "pi-tune.json"), "utf8"), /"enabled": false/);
});

test("/suggest model rejects an unknown model", async () => {
  const h = harness('{"suggest":{"enabled":false}}');
  await h.session.runSuggestCommand("model nope/x", h.ctx);
  assert.equal(h.notified.at(-1)?.level, "error");
  assert.match(h.notified.at(-1)?.message ?? "", /not a known provider\/model/);
});

test("an unknown model in the file disables suggestions with a warning", () => {
  const h = harness('{"suggest":{"enabled":true,"model":"nope/x"}}');
  assert.equal(h.notified.at(-1)?.level, "warning");
  assert.match(h.notified.at(-1)?.message ?? "", /Next-step suggestion model "nope\/x" is not a known/);
});

test("completions offer the command words and the model ids", () => {
  const h = harness('{"suggest":{"enabled":false}}');
  assert.deepEqual(
    (h.session.suggestCompletions("") ?? []).map((match) => match.value),
    ["on", "off", "model", "style"],
  );
  assert.deepEqual(
    (h.session.suggestCompletions("model ") ?? []).map((match) => match.value),
    ["model session", "model anthropic/claude"],
  );
  assert.deepEqual(
    (h.session.suggestCompletions("style ") ?? []).map((match) => match.value),
    ["style careful", "style eager"],
  );
  assert.equal(h.session.suggestCompletions("x"), null);
});

test("shutdown silences /suggest until the next session", async () => {
  const h = harness('{"suggest":{"enabled":false}}');
  h.session.shutdown();
  await h.session.runSuggestCommand("on", h.ctx);
  assert.equal(h.notified.at(-1)?.level, "warning");
  assert.match(h.notified.at(-1)?.message ?? "", /needs an interactive session/);
});

test("an unreadable Pi layout warns once and keeps Pi's own look", () => {
  const h = harness('{"suggest":{"enabled":false}}');
  const editor = mountEditor(h);
  (editor as unknown as { renderBottomBorder: (width: number, hidden: number) => string }).renderBottomBorder = (
    width,
  ) => "─".repeat(width);
  editor.setText("hello");
  editor.render(60);
  editor.render(60);
  assert.deepEqual(h.notified, [
    {
      message: "pi-tune editor: Pi's editor rows have no bottom border marker; the input box keeps Pi's own look.",
      level: "warning",
    },
  ]);
});

test("a start outside the TUI forgets the previous session", () => {
  const h = harness('{"suggest":{"enabled":false}}');
  const editor = mountEditor(h);
  const other = makeContext(h.dir, "print");
  h.session.start(other.ctx);

  // A failed paste preview and an unreadable layout both notify through the session's ctx; the old editor keeps
  // rendering after the reset, and neither ctx may hear from it.
  editor.setText("[paste #2 +12 lines]");
  editor.handleInput("\x1b[D");
  editor.handleInput("\r");
  (editor as unknown as { renderBottomBorder: (width: number, hidden: number) => string }).renderBottomBorder = (
    width,
  ) => "─".repeat(width);
  editor.render(60);
  assert.deepEqual(h.notified, []);
  assert.deepEqual(other.notified, []);
});
