import assert from "node:assert/strict";
import { test } from "node:test";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import { TuneEditor } from "./tune-editor.ts";

function makeEditor(onPreview?: (id: number) => void): TuneEditor {
  const tui = { requestRender() {}, terminal: { rows: 30, cols: 100 } } as unknown as TUI;
  const theme = { borderColor: (text: string) => text, selectList: {} } as EditorTheme;
  const keybindings = { matches: () => false } as unknown as KeybindingsManager;
  return new TuneEditor(tui, theme, keybindings, { model: "scripted", thinking: "high", onPreview });
}

function lastLine(editor: TuneEditor, width = 60): string {
  const lines = editor.render(width);
  return lines[lines.length - 1] ?? "";
}

test("large programmatic inserts collapse through the paste path", () => {
  const editor = makeEditor();
  const content = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  editor.insertTextAtCursor(content);
  assert.equal(editor.getText(), "[paste #1 +30 lines]");
  assert.equal(editor.readPaste(1), content);
});

test("small programmatic inserts stay literal", () => {
  const editor = makeEditor();
  editor.insertTextAtCursor("hello");
  assert.equal(editor.getText(), "hello");
});

test("ctrl+s stashes a draft and restores it with the cursor", () => {
  const editor = makeEditor();
  editor.setText("half written");
  editor.handleInput("\x13");
  assert.equal(editor.getText(), "");
  assert.match(lastLine(editor), /stashed/);

  editor.handleInput("\x13");
  assert.equal(editor.getText(), "half written");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 12 });
  assert.doesNotMatch(lastLine(editor), /stashed/);
});

test("a non-empty editor replaces the single stash slot", () => {
  const editor = makeEditor();
  editor.setText("first");
  editor.handleInput("\x13");
  editor.setText("second");
  editor.handleInput("\x13");
  editor.handleInput("\x13");
  assert.equal(editor.getText(), "second");
});

test("stashing keeps expanded paste content", () => {
  const editor = makeEditor();
  const content = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  editor.setText("before ");
  editor.handleInput(`\x1b[200~${content}\x1b[201~`);
  assert.equal(editor.getText(), "before [paste #1 +30 lines]");
  editor.handleInput("\x13");
  editor.handleInput("\x13");
  assert.ok(!editor.getText().includes("[paste #"));
  assert.ok(editor.getText().includes("line 0"));
  assert.ok(editor.getText().includes("line 29"));
});

test("enter on a marker opens the preview instead of submitting", () => {
  const previews: number[] = [];
  const editor = makeEditor((id) => previews.push(id));
  editor.setText("[paste #2 +12 lines]");
  editor.handleInput("\x1b[D");
  editor.handleInput("\r");
  assert.deepEqual(previews, [2]);
});

test("enter just past a marker submits", () => {
  const previews: number[] = [];
  const editor = makeEditor((id) => previews.push(id));
  let submitted = "";
  editor.onSubmit = (text) => {
    submitted = text;
  };
  editor.setText("[paste #2 +12 lines]");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 20 });
  editor.handleInput("\r");
  assert.deepEqual(previews, []);
  assert.equal(submitted, "[paste #2 +12 lines]");
});

test("enter elsewhere still submits", () => {
  const editor = makeEditor();
  let submitted = "";
  editor.onSubmit = (text) => {
    submitted = text;
  };
  editor.setText("plain");
  editor.handleInput("\r");
  assert.equal(submitted, "plain");
});

test("double click on a marker opens the preview", () => {
  const previews: number[] = [];
  const editor = makeEditor((id) => previews.push(id));
  editor.setText("[paste #3 +12 lines]");
  editor.render(60);
  const event: TuiMouseEvent = {
    type: "click",
    button: "left",
    x: 4,
    y: 1,
    screenX: 4,
    screenY: 1,
    width: 60,
    height: 3,
    shift: false,
    alt: false,
    ctrl: false,
    clickCount: 2,
  };
  editor.handleMouse(event);
  assert.deepEqual(previews, [3]);
});

test("the bottom border carries model and thinking at every width", () => {
  const editor = makeEditor();
  for (const width of [80, 40, 20]) {
    const line = lastLine(editor, width);
    assert.equal(visibleWidth(line), width);
  }
  assert.match(lastLine(editor, 80), /scripted · high/);
});
