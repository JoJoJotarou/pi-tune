import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { testTheme } from "../../test/theme.ts";
import { createEditorSession, type EditorContext, type EditorHost, type EditorSession } from "./session.ts";

interface Notice {
  message: string;
  level: string;
}

interface Harness {
  session: EditorSession;
  dir: string;
  notified: Notice[];
  ctx: EditorContext;
}

function harness(config: string | undefined): Harness {
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-editor-"));
  if (config !== undefined) writeFileSync(join(dir, "pi-tune.json"), config);
  const notified: Notice[] = [];
  const models = [{ provider: "anthropic", id: "claude" }];
  const ctx = {
    mode: "tui",
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
      setEditorComponent: () => {},
      theme: testTheme("dark"),
    },
  } as unknown as EditorContext;
  const host: EditorHost = {
    settings: () => ({ editorPaddingX: 2, autocompleteMaxVisible: 5 }),
    thinkingLevel: () => "off",
    agentDir: () => dir,
    now: () => 1_000,
    emitStash: () => {},
    emitReady: () => {},
  };
  const session = createEditorSession(host);
  session.start(ctx);
  return { session, dir, notified, ctx };
}

test("start reports a broken settings file once", () => {
  const h = harness("{ not json");
  assert.equal(h.notified.length, 1);
  assert.equal(h.notified[0].level, "warning");
  assert.match(h.notified[0].message, /is not valid JSON/);
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
