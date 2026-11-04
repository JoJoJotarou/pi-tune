import assert from "node:assert/strict";
import { test } from "node:test";
import { type KeybindingsManager, keyText } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI, TuiMouseEvent } from "@earendil-works/pi-tui";
import { CURSOR_MARKER, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { frameEditor, TuneEditor, type TuneEditorOptions } from "./tune-editor.ts";

const theme = testTheme();
const plain = (line: string) => stripTerminalSequences(line);

type Options = Partial<TuneEditorOptions> & { paddingX?: number };

/** `matches` answers the app keybindings; the default claims none, like a terminal that never sends them. */
function makeEditor(options: Options = {}, matches: (binding: string) => boolean = () => false): TuneEditor {
  const tui = { requestRender() {}, terminal: { rows: 30, cols: 100 } } as unknown as TUI;
  const editorTheme = { borderColor: (text: string) => text, selectList: {} } as EditorTheme;
  const keybindings = {
    matches: (_data: string, binding: string) => matches(binding),
  } as unknown as KeybindingsManager;
  return new TuneEditor(tui, editorTheme, keybindings, {
    model: "scripted",
    thinking: "high",
    theme: () => theme,
    ...options,
  });
}

function lastLine(editor: TuneEditor, width = 60): string {
  const lines = editor.render(width);
  return lines[lines.length - 1] ?? "";
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

test("the editor is a rounded box around its content", () => {
  const editor = makeEditor();
  editor.setText("hello");
  const lines = editor.render(40).map(plain);
  assert.equal(lines[0], `╭${"─".repeat(38)}╮`);
  assert.match(lines[1] ?? "", /^│hello +│$/);
  assert.match(lines[lines.length - 1] ?? "", /^╰─+ scripted · high ─╯$/);
});

test("every editor line is exactly the width it was given", () => {
  const editor = makeEditor();
  editor.setText("a long line that has to wrap several times over to fill the box ".repeat(4));
  for (const width of [40, 100]) {
    for (const line of editor.render(width)) assert.equal(visibleWidth(line), width);
  }
});

test("the frame keeps the cursor marker inside the side borders", () => {
  const editor = makeEditor();
  editor.focused = true;
  editor.setText("hello");
  const lines = editor.render(40);
  const marked = lines.find((line) => line.includes(CURSOR_MARKER));
  assert.ok(marked, "no line carries the cursor marker");
  assert.ok(plain(marked).startsWith("│"));
});

test("the working status stays on the top border, inside the corners", () => {
  const editor = makeEditor();
  type Indicator = NonNullable<Parameters<TuneEditor["setWorkingStatusIndicator"]>[0]>;
  editor.setWorkingStatusIndicator({
    renderInBorder: () => "⚙ Thinking  ls -la",
    renderSpinnerInBorder: () => "⠋",
    dispose() {},
  } as unknown as Indicator);
  const top = plain(editor.render(40)[0] ?? "");
  assert.equal(visibleWidth(top), 40);
  assert.ok(top.startsWith("╭") && top.endsWith("╮"), top);
  assert.ok(top.includes("⚙ Thinking  ls -la"), top);
});

test("the working status takes the border color, like the model label", () => {
  const editor = makeEditor();
  const magenta = (text: string) => `\x1b[35m${text}\x1b[39m`;
  (editor as unknown as { borderColor: (text: string) => string }).borderColor = magenta;
  type Indicator = NonNullable<Parameters<TuneEditor["setWorkingStatusIndicator"]>[0]>;
  editor.setWorkingStatusIndicator({
    renderInBorder: () => `${theme.fg("text", "Working")}  ${theme.fg("dim", "3.2s · esc to stop")}`,
    renderSpinnerInBorder: () => "",
    dispose() {},
  } as unknown as Indicator);
  const top = editor.render(60)[0] ?? "";
  assert.ok(top.includes(magenta("Working  3.2s · esc to stop")), JSON.stringify(top));
  assert.ok(!top.includes(theme.getFgAnsi("text")), "the status keeps none of its own colors");
});

test("autocomplete lines below the box are left unwrapped and never wider than the width", () => {
  const lines = ["──────", "text  ", "──────", "  a completion row that is far too long to fit"];
  const framed = frameEditor(lines, 20, (text) => text, 2, {});
  assert.deepEqual(framed.slice(0, 3).map(plain), [
    `╭${"─".repeat(18)}╮`,
    `│text${" ".repeat(14)}│`,
    `╰${"─".repeat(18)}╯`,
  ]);
  assert.equal(plain(framed[3] ?? ""), "  a completion row t");
});

test("a long model id is cut with an ellipsis and both corners survive", () => {
  const editor = makeEditor({ model: "deepseek-v4.1-flash-preview-0125-extremely-long-model-identifier" });
  const line = plain(lastLine(editor, 50));
  assert.equal(visibleWidth(line), 50);
  assert.ok(line.startsWith("╰") && line.endsWith("╯"), line);
  assert.match(line, /… ─╯$/);
});

test("ctrl+s stashes a draft and restores it with the cursor", () => {
  const editor = makeEditor();
  editor.setText("half written");
  editor.handleInput("\x13");
  assert.equal(editor.getText(), "");
  assert.match(plain(lastLine(editor)), /stashed/);

  editor.handleInput("\x13");
  assert.equal(editor.getText(), "half written");
  assert.deepEqual(editor.getCursor(), { line: 0, col: 12 });
  assert.doesNotMatch(plain(lastLine(editor)), /stashed/);
});

test("a second ctrl+s asks before replacing the stash", () => {
  let now = 1000;
  const editor = makeEditor({ now: () => now });
  editor.setText("first");
  editor.handleInput("\x13");
  editor.setText("second");

  editor.handleInput("\x13");
  assert.equal(editor.getText(), "second", "the held stash was replaced without asking");
  assert.ok(lastLine(editor).includes(theme.fg("warning", "ctrl+s again to replace stash")));

  now += 1000;
  editor.handleInput("\x13");
  assert.equal(editor.getText(), "");
  assert.doesNotMatch(plain(lastLine(editor)), /replace stash/);

  editor.handleInput("\x13");
  assert.equal(editor.getText(), "second");
});

test("any other key cancels the replace prompt", () => {
  const editor = makeEditor({ now: () => 1000 });
  editor.setText("first");
  editor.handleInput("\x13");
  editor.setText("second");
  editor.handleInput("\x13");
  assert.match(plain(lastLine(editor)), /replace stash/);

  editor.handleInput("x");
  assert.equal(editor.getText(), "secondx");
  assert.doesNotMatch(plain(lastLine(editor)), /replace stash/);

  editor.handleInput("\x13");
  assert.equal(editor.getText(), "secondx", "the stash was replaced after the prompt was cancelled");
  assert.match(plain(lastLine(editor)), /replace stash/);
});

test("the replace prompt expires after three seconds", () => {
  let now = 1000;
  const editor = makeEditor({ now: () => now });
  editor.setText("first");
  editor.handleInput("\x13");
  editor.setText("second");
  editor.handleInput("\x13");

  now += 3001;
  assert.doesNotMatch(plain(lastLine(editor)), /replace stash/);
  editor.handleInput("\x13");
  assert.equal(editor.getText(), "second");
  assert.match(plain(lastLine(editor)), /replace stash/);
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
  const border = () => plain(lastLine(editor));
  assert.doesNotMatch(border(), /again to exit/);

  editor.handleInput("\x03");
  assert.ok(border().includes(`${keyText("app.clear")} again to exit`), border());

  now += 501;
  assert.doesNotMatch(border(), /again to exit/);
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
  assert.match(plain(lastLine(editor, 80)), /scripted · high/);
});

test("the ghost suggestion overlays the empty editor's content row", () => {
  const editor = makeEditor();
  editor.setSuggestion("run the tests");
  const lines = editor.render(40).map(plain);
  assert.equal(lines.length, 3, `the box keeps its size:\n${lines.join("\n")}`);
  assert.match(lines[1] ?? "", /run the tests/);
});

test("the ghost suggestion disappears once the editor has text", () => {
  const editor = makeEditor();
  editor.setSuggestion("run the tests");
  editor.setText("hello");
  const lines = editor.render(40).map(plain);
  assert.match(lines[1] ?? "", /^│hello +│$/);
  assert.ok(!lines.some((line) => line.includes("run the tests")));
});

test("clearing the editor shows the suggestion again until it is discarded", () => {
  const editor = makeEditor();
  editor.setSuggestion("run the tests");
  editor.setText("hello");
  editor.setText("");
  assert.match(plain(editor.render(40)[1] ?? ""), /run the tests/);
  editor.setSuggestion(undefined);
  assert.ok(!plain(editor.render(40)[1] ?? "").includes("run the tests"));
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
  editor.setSuggestion("a suggestion that is far too long for a narrow editor box".repeat(2));
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
  const row = plain(editor.render(40)[1] ?? "");
  assert.match(row, /^│运行 测试并提交 +│$/);
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
  assert.ok(!plain(editor.render(40)[1] ?? "").includes("提交"));
  editor.setText("");
  assert.match(plain(editor.render(40)[1] ?? ""), /运行测试并提交/);
});

test("the rest stays hidden while the cursor is not at the end or the draft has several lines", () => {
  const editor = makeEditor();
  editor.setSuggestion("运行测试并提交");
  editor.setText("运行");
  editor.handleInput(LEFT);
  assert.ok(!editor.render(40).map(plain).join("\n").includes("提交"));
  editor.handleInput(RIGHT);
  assert.equal(editor.getText(), "运行", "right arrow only moved the cursor");
  editor.setText("运行\n");
  assert.ok(!editor.render(40).map(plain).join("\n").includes("提交"));
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

test("btw mode recolors the frame, labels the top border, and keeps the working status", () => {
  const editor = makeEditor();
  editor.setBtwMode(true);
  const accent = theme.getFgAnsi("borderAccent");
  const lines = editor.render(60);
  assert.ok(lines[0]?.startsWith(`${accent}╭`), JSON.stringify(lines[0]));
  assert.ok(plain(lines[0] ?? "").startsWith("╭─ btw ─"), plain(lines[0] ?? ""));
  assert.ok(plain(lines[1] ?? "").startsWith("│"));

  type Indicator = NonNullable<Parameters<TuneEditor["setWorkingStatusIndicator"]>[0]>;
  editor.setWorkingStatusIndicator({
    renderInBorder: () => "Working",
    renderSpinnerInBorder: () => "",
    dispose() {},
  } as unknown as Indicator);
  assert.ok(plain(editor.render(60)[0] ?? "").startsWith("╭─ btw · Working ─"));

  editor.setBtwMode(false);
  assert.ok(!plain(editor.render(60)[0] ?? "").includes("btw"));
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
