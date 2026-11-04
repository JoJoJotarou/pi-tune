import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { type Component, visibleWidth } from "@earendil-works/pi-tui";
import { SuggestPanel } from "./suggest-panel.ts";
import type { SuggestSettings } from "./suggest-settings.ts";

initTheme("dark", false);

const rows = (panel: SuggestPanel) => panel.render(40).filter((line) => line.trim() !== "");

function picker(done: (modelId?: string) => void, picked = "faux/scripted"): Component {
  return {
    render: () => ["picker"],
    invalidate() {},
    handleInput(data: string) {
      if (data === "\r") done(picked);
    },
  };
}

function panel(
  settings: SuggestSettings,
  modelPicker: ((done: (id?: string) => void) => Component) | Error = (done) => picker(done),
) {
  const changes: SuggestSettings[] = [];
  const warnings: string[] = [];
  const instance = new SuggestPanel({
    settings,
    tui: { requestRender() {} },
    onChange: (next) => {
      changes.push(next);
      return next;
    },
    onClose() {},
    onWarning: (message) => warnings.push(message),
    modelPicker,
  });
  return { instance, changes, warnings };
}

test("off shows one row", () => {
  const { instance } = panel({ enabled: false });
  const text = rows(instance).join("\n");
  assert.match(text, /Next-step suggestions/);
  assert.match(text, /off/);
  assert.ok(!text.includes("Model"), text);
});

test("enter turns suggestions on, adds the model row and emits the settings", () => {
  const { instance, changes } = panel({ enabled: false });
  instance.handleInput("\r");
  assert.deepEqual(changes, [{ enabled: true }]);
  const text = rows(instance).join("\n");
  assert.match(text, /Next-step suggestions/);
  assert.match(text, /on/);
  assert.match(text, /Model/);
  assert.match(text, /session model/);
});

test("enter again turns suggestions off and drops the model row", () => {
  const { instance, changes } = panel({ enabled: true });
  instance.handleInput("\r");
  assert.deepEqual(changes, [{ enabled: false }]);
  const text = rows(instance).join("\n");
  assert.match(text, /off/);
  assert.ok(!text.includes("Model"), text);
});

test("a picked model is shown and emitted", () => {
  const { instance, changes } = panel({ enabled: true });
  instance.handleInput("\x1b[B");
  instance.handleInput("\r");
  instance.handleInput("\r");
  assert.deepEqual(changes, [{ enabled: true, model: "faux/scripted" }]);
  assert.match(rows(instance).join("\n"), /faux\/scripted/);
});

test("cancelling the picker keeps the session model", () => {
  const { instance, changes } = panel({ enabled: true }, (done) => ({
    render: () => ["picker"],
    invalidate() {},
    handleInput(data: string) {
      if (data === "\x1b") done();
    },
  }));
  instance.handleInput("\x1b[B");
  instance.handleInput("\r");
  instance.handleInput("\x1b");
  assert.deepEqual(changes, []);
  assert.match(rows(instance).join("\n"), /session model/);
});

test("a model row without a runtime warns instead of opening a picker", () => {
  const { instance, changes, warnings } = panel({ enabled: true }, new Error("pi-tune: no runtime."));
  instance.handleInput("\x1b[B");
  instance.handleInput("\r");
  assert.deepEqual(changes, []);
  assert.deepEqual(warnings, ["pi-tune: no runtime."]);
  assert.match(rows(instance).join("\n"), /session model/);
});

test("every row fits width 40", () => {
  for (const settings of [{ enabled: false }, { enabled: true }, { enabled: true, model: "faux/scripted" }]) {
    const { instance } = panel(settings);
    for (const line of instance.render(40)) {
      assert.ok(visibleWidth(line) <= 40, `${visibleWidth(line)}: ${line}`);
    }
  }
});
