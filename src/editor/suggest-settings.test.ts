import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadSuggestSettings, type SuggestCommand, saveSuggestSettings, suggestCommand } from "./suggest-settings.ts";

function withDir(body: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-suggest-"));
  try {
    body(join(dir, "pi-tune.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a missing config file means suggestions are off", () => {
  withDir((path) => {
    assert.deepEqual(loadSuggestSettings(path), { ok: true, settings: { enabled: false } });
  });
});

test("a config without a suggest key means suggestions are off", () => {
  withDir((path) => {
    writeFileSync(path, JSON.stringify({ theme: "dark" }));
    assert.deepEqual(loadSuggestSettings(path), { ok: true, settings: { enabled: false } });
  });
});

test("the config carries the switch and the model", () => {
  withDir((path) => {
    writeFileSync(path, JSON.stringify({ suggest: { enabled: true, model: "provider/id" } }));
    assert.deepEqual(loadSuggestSettings(path), { ok: true, settings: { enabled: true, model: "provider/id" } });
  });
});

test("malformed JSON names the file and the problem", () => {
  withDir((path) => {
    writeFileSync(path, "{");
    const loaded = loadSuggestSettings(path);
    assert.equal(loaded.ok, false);
    assert.ok(!loaded.ok && loaded.problem.includes(path), loaded.ok ? "" : loaded.problem);
    assert.ok(!loaded.ok && loaded.problem.includes("not valid JSON"), loaded.ok ? "" : loaded.problem);
  });
});

test("wrong types name the file and the problem", () => {
  for (const [raw, problem] of [
    ["[]", "must contain a JSON object"],
    ['{"suggest": true}', '"suggest"'],
    ['{"suggest": {"enabled": "yes"}}', '"suggest.enabled"'],
    ['{"suggest": {"model": 7}}', '"suggest.model"'],
  ] as const) {
    withDir((path) => {
      writeFileSync(path, raw);
      const loaded = loadSuggestSettings(path);
      assert.equal(loaded.ok, false, raw);
      assert.ok(!loaded.ok && loaded.problem.includes(path), raw);
      assert.ok(!loaded.ok && loaded.problem.includes(problem), `${raw}: ${loaded.ok ? "" : loaded.problem}`);
    });
  }
});

test("saving keeps unknown top-level keys", () => {
  withDir((path) => {
    writeFileSync(path, JSON.stringify({ theme: "dark", suggest: { enabled: false } }));
    saveSuggestSettings(path, { enabled: true, model: "provider/id" });
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), {
      theme: "dark",
      suggest: { enabled: true, model: "provider/id" },
    });
  });
});

test("saving without a model drops the stored model and creates the file", () => {
  withDir((path) => {
    writeFileSync(path, JSON.stringify({ suggest: { enabled: true, model: "provider/id" } }));
    saveSuggestSettings(path, { enabled: true });
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { suggest: { enabled: true } });
    rmSync(path);
    saveSuggestSettings(path, { enabled: false });
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { suggest: { enabled: false } });
  });
});

test("saving refuses to overwrite a file it cannot read", () => {
  withDir((path) => {
    writeFileSync(path, "{");
    assert.throws(() => saveSuggestSettings(path, { enabled: true }), /not valid JSON/);
    assert.equal(readFileSync(path, "utf8"), "{");
  });
});

const known = (id: string) => id === "cheap/mini";
const errorOf = (result: SuggestCommand) => ("error" in result ? result.error : "");

test("/suggest on and off keep the chosen model", () => {
  assert.deepEqual(suggestCommand("off", { enabled: true, model: "cheap/mini" }, known), {
    settings: { enabled: false, model: "cheap/mini" },
  });
  assert.deepEqual(suggestCommand("on", { enabled: false, model: "cheap/mini" }, known), {
    settings: { enabled: true, model: "cheap/mini" },
  });
});

test("/suggest model sets the model and keeps the switch", () => {
  assert.deepEqual(suggestCommand("model cheap/mini", { enabled: false }, known), {
    settings: { enabled: false, model: "cheap/mini" },
  });
  assert.deepEqual(suggestCommand("model session", { enabled: true, model: "cheap/mini" }, known), {
    settings: { enabled: true },
  });
});

test("/suggest rejects an unknown model and bad arguments", () => {
  assert.equal(
    errorOf(suggestCommand("model nope/x", { enabled: true }, known)),
    'Next-step suggestion model "nope/x" is not a known provider/model.',
  );
  for (const args of ["maybe", "on now", "model", "model a b"]) {
    assert.equal(
      errorOf(suggestCommand(args, { enabled: true }, known)),
      "Usage: /suggest [on|off|model <provider/id|session>|style <careful|eager>]",
      args,
    );
  }
});

test("the style is saved, read back, and checked", () => {
  withDir((path) => {
    saveSuggestSettings(path, { enabled: true, style: "eager" });
    assert.deepEqual(loadSuggestSettings(path), { ok: true, settings: { enabled: true, style: "eager" } });
    writeFileSync(path, JSON.stringify({ suggest: { enabled: true, style: "wild" } }));
    const loaded = loadSuggestSettings(path);
    assert.ok(!loaded.ok && loaded.problem.includes('"suggest.style"'), JSON.stringify(loaded));
  });
});

test("/suggest style sets the style and keeps the rest; model session keeps the style", () => {
  assert.deepEqual(suggestCommand("style eager", { enabled: true, model: "cheap/mini" }, known), {
    settings: { enabled: true, model: "cheap/mini", style: "eager" },
  });
  assert.deepEqual(suggestCommand("model session", { enabled: true, model: "cheap/mini", style: "eager" }, known), {
    settings: { enabled: true, style: "eager" },
  });
  assert.match(errorOf(suggestCommand("style wild", { enabled: true }, known)), /^Usage: \/suggest/);
});
