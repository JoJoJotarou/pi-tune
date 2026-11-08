import assert from "node:assert/strict";
import { test } from "node:test";
import { type KeybindingsManager, keyText } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { TuneEditor, type TuneEditorOptions } from "./tune-editor.ts";

const theme = testTheme();
const plain = (line: string) => stripTerminalSequences(line);
/** The tool block color Pi's dark theme gives `toolPendingBg`, the block's fill. */
const blockBg = theme.getBgAnsi("toolPendingBg");

type Options = Partial<TuneEditorOptions> & { paddingX?: number };

/** `matches` answers the app keybindings; the default claims none, like a terminal that never sends them. */
function makeEditor(options: Options = {}, matches: (binding: string) => boolean = () => false): TuneEditor {
  const tui = { requestRender() {}, terminal: { rows: 30, cols: 100 } } as unknown as TUI;
  const editorTheme = { borderColor: (text: string) => text, selectList: {} } as EditorTheme;
  const keybindings = {
    matches: (_data: string, binding: string) => matches(binding),
  } as unknown as KeybindingsManager;
  return new TuneEditor(tui, editorTheme, keybindings, {
    theme: () => theme,
    ...options,
  });
}

function rendered(editor: TuneEditor, width = 60): string[] {
  return editor.render(width).map(plain);
}

function firstContent(editor: TuneEditor, width = 60): string {
  return rendered(editor, width).find((line) => line.includes("❯")) ?? "";
}

const pasted = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");

test("large programmatic inserts collapse through the paste path", () => {
  const editor = makeEditor();
  editor.insertTextAtCursor(pasted);
  assert.equal(editor.getText(), "[paste #1 +30 lines]");
  assert.equal(editor.readPaste(1), pasted);
});

test("small programmatic inserts stay literal", () => {
  const editor = makeEditor();
  editor.insertTextAtCursor("hello");
  assert.equal(editor.getText(), "hello");
});

test("the editor is one background block with a chevron, and no border", () => {
  const editor = makeEditor();
  editor.setText("hello");
  const lines = editor.render(40);
  assert.equal(lines.length, 3, `half-row edge, the draft, half-row edge:\n${lines.map(plain).join("\n")}`);
  assert.ok(!lines.some((line) => plain(line).match(/[╭╮╰╯│─]/)), "no box drawing survives");
  assert.match(plain(lines[1] ?? ""), /^ ❯ hello + $/);
  assert.ok(lines[1]?.includes(blockBg), "the draft row is filled with the block background");
  assert.equal(plain(lines[0] ?? ""), "▄".repeat(40), "the row above paints the lower half");
  assert.equal(plain(lines[2] ?? ""), "▀".repeat(40), "the row below paints the upper half");
});

test("every editor line is exactly the width it was given", () => {
  const editor = makeEditor();
  editor.setText("a long line that has to wrap several times over to fill the block ".repeat(4));
  for (const width of [40, 100]) {
    for (const line of editor.render(width)) assert.equal(visibleWidth(line), width);
  }
});

test("a wrapped draft indents its continuation rows under the text", () => {
  const editor = makeEditor();
  editor.setText("alpha beta gamma delta epsilon zeta eta theta iota kappa lambda");
  const lines = rendered(editor, 40).filter((line) => line.startsWith(" ") || line.startsWith("❯"));
  assert.ok(lines.length > 1, lines.join("\n"));
  assert.match(lines[0] ?? "", /^ ❯ alpha/);
  for (const line of lines.slice(1)) assert.match(line, /^ {3}\S/, line);
});

test("the block still holds at sixteen columns", () => {
  const editor = makeEditor();
  editor.setText("narrow");
  const line = firstContent(editor, 16);
  assert.match(line, /^ ❯ narrow/, line);
  assert.equal(visibleWidth(line), 16);
});

test("the block keeps the cursor marker inside the gutter", () => {
  const editor = makeEditor();
  editor.focused = true;
  editor.setText("hello");
  const marked = editor.render(40).find((line) => line.includes(CURSOR_MARKER));
  assert.ok(marked, "no line carries the cursor marker");
  assert.match(plain(marked), /^ ❯ hello/);
});

test("the chevron carries Pi's editor border color, which follows the thinking level", () => {
  const editor = makeEditor();
  const magenta = (text: string) => `\x1b[35m${text}\x1b[39m`;
  (editor as unknown as { borderColor: (text: string) => string }).borderColor = magenta;
  editor.setText("hello");
  const block = editor.render(40).find((line) => line.includes("❯")) ?? "";
  assert.ok(block.includes(magenta("❯")), "the chevron is not painted");
});

test("the working status moves to its own line above the block", () => {
  const editor = makeEditor();
  type Indicator = NonNullable<Parameters<TuneEditor["setWorkingStatusIndicator"]>[0]>;
  editor.setWorkingStatusIndicator({
    renderInBorder: () => "⚙ Thinking  ls -la",
    renderSpinnerInBorder: () => "⠋",
    dispose() {},
  } as unknown as Indicator);
  editor.setText("draft");
  const lines = rendered(editor, 40);
  assert.equal(lines.length, 4, lines.join("\n"));
  assert.equal(lines[0], " ⚙ Thinking  ls -la");
  assert.match(lines[2] ?? "", /^ ❯ draft/);
});

test("the status line keeps Pi's own colors instead of the border color", () => {
  const editor = makeEditor();
  type Indicator = NonNullable<Parameters<TuneEditor["setWorkingStatusIndicator"]>[0]>;
  editor.setWorkingStatusIndicator({
    renderInBorder: () => `${theme.fg("text", "Working")}  ${theme.fg("dim", "3.2s · esc to stop")}`,
    renderSpinnerInBorder: () => "",
    dispose() {},
  } as unknown as Indicator);
  const top = editor.render(60)[0] ?? "";
  assert.ok(top.includes(theme.fg("text", "Working")), JSON.stringify(top));
});

test("the status line never exceeds the width it was given", () => {
  const editor = makeEditor();
  type Indicator = NonNullable<Parameters<TuneEditor["setWorkingStatusIndicator"]>[0]>;
  editor.setWorkingStatusIndicator({
    renderInBorder: () => `Working ${"long status ".repeat(10)}`,
    renderSpinnerInBorder: () => "",
    dispose() {},
  } as unknown as Indicator);
  for (const width of [40, 20]) {
    for (const line of editor.render(width)) assert.equal(visibleWidth(line), width);
  }
});

test("ctrl+s stashes a draft and restores it with the cursor", () => {
  const editor = makeEditor();
  editor.setText("half written");
  editor.handleInput("\x13");
  assert.equal(editor.getText(), "");

  editor.handleInput("\x13");
  assert.equal(editor.getText(), "half written");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 12 });
});

test("a second ctrl+s asks before replacing the stash", () => {
  let now = 1000;
  const editor = makeEditor({ now: () => now });
  editor.setText("first");
  editor.handleInput("\x13");
  editor.setText("second");

  editor.handleInput("\x13");
  assert.equal(editor.getText(), "second", "the held stash was replaced without asking");
  assert.ok((editor.render(60)[0] ?? "").includes(` ${theme.fg("warning", "ctrl+s again to replace stash")}`));

  now += 1000;
  editor.handleInput("\x13");
  assert.equal(editor.getText(), "");
  assert.ok(!rendered(editor).some((line) => line.includes("replace stash")));

  editor.handleInput("\x13");
  assert.equal(editor.getText(), "second");
});

test("any other key cancels the replace prompt", () => {
  const editor = makeEditor({ now: () => 1000 });
  editor.setText("first");
  editor.handleInput("\x13");
  editor.setText("second");
  editor.handleInput("\x13");
  assert.ok(rendered(editor).some((line) => line.includes("replace stash")));

  editor.handleInput("x");
  assert.equal(editor.getText(), "secondx");
  assert.ok(!rendered(editor).some((line) => line.includes("replace stash")));

  editor.handleInput("\x13");
  assert.equal(editor.getText(), "secondx", "the stash was replaced after the prompt was cancelled");
  assert.ok(rendered(editor).some((line) => line.includes("replace stash")));
});

test("the replace prompt expires after three seconds", () => {
  let now = 1000;
  const editor = makeEditor({ now: () => now });
  editor.setText("first");
  editor.handleInput("\x13");
  editor.setText("second");
  editor.handleInput("\x13");

  now += 3001;
  assert.ok(!rendered(editor).some((line) => line.includes("replace stash")));
  editor.handleInput("\x13");
  assert.equal(editor.getText(), "second");
  assert.ok(rendered(editor).some((line) => line.includes("replace stash")));
});

test("the stash reports when it is held, so the footer can name the next ctrl+s", () => {
  const held: boolean[] = [];
  const editor = makeEditor({ onStashChange: (value) => held.push(value) });
  editor.setText("draft");
  editor.handleInput("\x13");
  editor.handleInput("\x13");
  assert.deepEqual(held, [true, false]);
});

test("ctrl+c names the second press that exits, for Pi's half-second window", () => {
  let now = 1000;
  const editor = makeEditor({ now: () => now }, (binding) => binding === "app.clear");
  const status = () => rendered(editor)[0] ?? "";
  assert.ok(!status().includes("again to exit"));

  editor.handleInput("\x03");
  assert.ok(status().includes(`${keyText("app.clear")} again to exit`), status());

  now += 501;
  assert.ok(!status().includes("again to exit"));
});

test("stashing keeps expanded paste content", () => {
  const editor = makeEditor();
  editor.setText("before ");
  editor.handleInput(`\x1b[200~${pasted}\x1b[201~`);
  assert.equal(editor.getText(), "before [paste #1 +30 lines]");
  editor.handleInput("\x13");
  editor.handleInput("\x13");
  assert.ok(!editor.getText().includes("[paste #"));
  assert.ok(editor.getText().includes("line 0"));
  assert.ok(editor.getText().includes("line 29"));
});

test("enter on a marker opens the preview instead of submitting", () => {
  const previews: number[] = [];
  const editor = makeEditor({ onPreview: (id) => previews.push(id) });
  editor.setText("[paste #2 +12 lines]");
  editor.handleInput("\x1b[D");
  editor.handleInput("\r");
  assert.deepEqual(previews, [2]);
});

test("enter just past a marker submits", () => {
  const previews: number[] = [];
  const editor = makeEditor({ onPreview: (id) => previews.push(id) });
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
  const editor = makeEditor({ onPreview: (id) => previews.push(id) });
  editor.setText("[paste #3 +12 lines]");
  editor.render(60);
  const event: TuiMouseEvent = {
    type: "click",
    button: "left",
    x: 8,
    y: 1,
    screenX: 8,
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

test("the ghost suggestion overlays the empty editor's block row", () => {
  const editor = makeEditor();
  editor.setSuggestion("run the tests");
  const lines = rendered(editor, 40);
  assert.equal(lines.length, 3, `the block keeps its size:\n${lines.join("\n")}`);
  assert.match(lines[1] ?? "", /^ ❯ +run the tests + $/);
});

test("the ghost suggestion disappears once the editor has text", () => {
  const editor = makeEditor();
  editor.setSuggestion("run the tests");
  editor.setText("hello");
  const lines = rendered(editor, 40);
  assert.match(lines[1] ?? "", /^ ❯ hello + $/);
  assert.ok(!lines.some((line) => line.includes("run the tests")));
});

test("clearing the editor shows the suggestion again until it is discarded", () => {
  const editor = makeEditor();
  editor.setSuggestion("run the tests");
  editor.setText("hello");
  editor.setText("");
  assert.match(firstContent(editor, 40), /run the tests/);
  editor.setSuggestion(undefined);
  assert.ok(!firstContent(editor, 40).includes("run the tests"));
});

test("tab fills the suggestion without submitting it", () => {
  const editor = makeEditor();
  editor.setSuggestion("run the tests");
  editor.handleInput("\t");
  assert.equal(editor.getText(), "run the tests");
  assert.equal(editor.getSuggestion(), undefined, "filling consumes the suggestion");
});

test("tab does nothing while the suggestion is hidden", () => {
  const editor = makeEditor();
  editor.handleInput("\t");
  assert.equal(editor.getText(), "");
  editor.setSuggestion("run the tests");
  editor.setText("x");
  editor.handleInput("\t");
  assert.equal(editor.getText(), "x");
});

test("the ghost line never exceeds the width it was given", () => {
  const editor = makeEditor();
  editor.setSuggestion("a suggestion that is far too long for a narrow editor block".repeat(2));
  for (const width of [40, 60, 80]) {
    for (const line of editor.render(width)) assert.equal(visibleWidth(line), width);
  }
});

test("any submit discards the suggestion before Pi handles it", () => {
  const calls: string[] = [];
  const editor = makeEditor({ onBeforeSubmit: () => calls.push("discard") });
  editor.onSubmit = (text) => calls.push(`submit:${text}`);
  for (const text of ["!echo hi", "/name x", "plain prompt"]) {
    calls.length = 0;
    editor.setSuggestion("run the tests");
    editor.setText(text);
    editor.handleInput("\r");
    assert.deepEqual(calls, ["discard", `submit:${text}`], text);
  }
});

test("a new line or an empty enter keeps the suggestion", () => {
  let discarded = 0;
  const editor = makeEditor({ onBeforeSubmit: () => discarded++ });
  editor.setSuggestion("run the tests");
  editor.handleInput("\r");
  editor.setText("draft");
  editor.handleInput("\n");
  assert.equal(discarded, 0);
  assert.equal(editor.getText(), "draft\n");
});

test("tab acceptance tells the owner, typing over the suggestion does not", () => {
  let accepted = 0;
  const editor = makeEditor({ onAcceptSuggestion: () => accepted++ });
  editor.setSuggestion("run the tests");
  editor.handleInput("x");
  editor.setText("");
  editor.handleInput("\t");
  assert.equal(accepted, 1);
  assert.equal(editor.getText(), "run the tests");
});

const RIGHT = "\x1b[C";
const LEFT = "\x1b[D";

test("typing the start of the suggestion shows the rest after the cursor", () => {
  const editor = makeEditor();
  editor.setSuggestion("运行测试并提交");
  editor.setText("运行");
  assert.match(firstContent(editor, 40), /^ ❯ 运行 测试并提交 + $/);
});

test("tab or right arrow completes a typed start into the whole suggestion", () => {
  for (const key of ["\t", RIGHT]) {
    let accepted = 0;
    const editor = makeEditor({ onAcceptSuggestion: () => accepted++ });
    editor.setSuggestion("运行测试并提交");
    editor.setText("运行");
    editor.handleInput(key);
    assert.equal(editor.getText(), "运行测试并提交", JSON.stringify(key));
    assert.equal(accepted, 1, JSON.stringify(key));
  }
});

test("a draft that diverges hides the suggestion, clearing it brings the whole line back", () => {
  const editor = makeEditor();
  editor.setSuggestion("运行测试并提交");
  editor.setText("部署");
  assert.ok(!firstContent(editor, 40).includes("提交"));
  editor.setText("");
  assert.match(firstContent(editor, 40), /运行测试并提交/);
});

test("the rest stays hidden while the cursor is not at the end or the draft has several lines", () => {
  const editor = makeEditor();
  editor.setSuggestion("运行测试并提交");
  editor.setText("运行");
  editor.handleInput(LEFT);
  assert.ok(!rendered(editor, 40).join("\n").includes("提交"));
  editor.handleInput(RIGHT);
  assert.equal(editor.getText(), "运行", "right arrow only moved the cursor");
  editor.setText("运行\n");
  assert.ok(!rendered(editor, 40).join("\n").includes("提交"));
});

test("the rest of a typed suggestion never exceeds the width", () => {
  for (const paddingX of [0, 1, 3]) {
    const editor = makeEditor({ paddingX });
    editor.setSuggestion(`运行${"测试并提交".repeat(10)}`);
    editor.setText("运行");
    for (const width of [40, 60, 80]) {
      for (const line of editor.render(width))
        assert.equal(visibleWidth(line), width, `paddingX ${paddingX} width ${width}`);
    }
  }
});

test("esc on the empty editor dismisses a shown suggestion and tells the owner", () => {
  let dismissed = 0;
  const editor = makeEditor({ onDismissSuggestion: () => dismissed++ });
  editor.handleInput("\x1b");
  assert.equal(dismissed, 0, "no suggestion, esc is Pi's");
  editor.setSuggestion("run the tests");
  editor.handleInput("\x1b");
  assert.equal(dismissed, 1);
  assert.equal(editor.getSuggestion(), undefined);
  editor.setSuggestion("run the tests");
  editor.setText("draft");
  editor.handleInput("\x1b");
  assert.equal(dismissed, 1, "with a draft, esc is Pi's");
});

test("btw mode tints the block and colors the chevron without naming itself", () => {
  const editor = makeEditor();
  editor.setBtwMode(true);
  const block = editor.render(60).find((line) => line.includes("❯")) ?? "";
  assert.ok(block.includes(theme.getBgAnsi("customMessageBg")), "the block takes the drawer color");
  assert.ok(block.includes(theme.fg("borderAccent", "❯")), "the chevron takes the drawer color");
  assert.equal(rendered(editor, 60).length, 3, "the drawer above names the mode, so no label row");
  assert.ok(!rendered(editor, 60).some((line) => line.includes("btw")));

  type Indicator = NonNullable<Parameters<TuneEditor["setWorkingStatusIndicator"]>[0]>;
  editor.setWorkingStatusIndicator({
    renderInBorder: () => "Working",
    renderSpinnerInBorder: () => "",
    dispose() {},
  } as unknown as Indicator);
  const withStatus = rendered(editor, 60);
  assert.equal(withStatus[0], " Working", "the status row carries no btw name");

  editor.setBtwMode(false);
  const plainBlock = editor.render(60).find((line) => line.includes("❯")) ?? "";
  assert.ok(plainBlock.includes(blockBg), "the block is back to the neutral fill");
});

test("btw mode hides the next-step suggestion and leaves it for the main session", () => {
  const calls: string[] = [];
  const editor = makeEditor({ onBeforeSubmit: () => calls.push("discard") });
  editor.setSuggestion("run the tests");
  editor.setBtwMode(true);
  assert.ok(!editor.render(60).some((line) => plain(line).includes("run the tests")));
  editor.handleInput("\t");
  assert.equal(editor.getText(), "", "tab does not fill a main-session suggestion");
  editor.setText("side question");
  editor.handleInput("\r");
  assert.deepEqual(calls, [], "a side question does not count against the suggestion");

  editor.setBtwMode(false);
  assert.ok(editor.render(60).some((line) => plain(line).includes("run the tests")));
});
