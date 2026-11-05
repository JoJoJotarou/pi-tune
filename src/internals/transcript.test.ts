import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  ScrollView,
  type ScrollViewScrollbar,
  Text,
  type TUI,
  VStack,
} from "@earendil-works/pi-tui";
import { asScrollable, collectPrompts, type Transcript } from "./transcript.ts";

initTheme("dark", false);

const transcriptLayout = () => new VStack([new ScrollView(new Container(), { primary: true })]);

test("collectPrompts reports a tree without the expected children", () => {
  const tui = {
    children: [{ render: () => [] }],
    layoutRoot: transcriptLayout(),
    terminal: { columns: 40, rows: 30 },
  } as unknown as TUI;

  const result = collectPrompts(tui);

  assert.ok(result instanceof Error);
  assert.match(result.message, /document has no component children/);
});

test("collectPrompts reports a document without a chat", () => {
  const tui = {
    children: [{ children: [{ render: () => [] }, { render: () => [] }], render: () => [] }],
    layoutRoot: transcriptLayout(),
    terminal: { columns: 40, rows: 30 },
  } as unknown as TUI;

  const result = collectPrompts(tui);

  assert.ok(result instanceof Error);
  assert.match(result.message, /document has 2 children/);
});

function transcriptTui(resources: Component, scrollbar: ScrollViewScrollbar): TUI {
  const chat = new Container();
  chat.addChild(new UserMessageComponent("question"));
  const document = new Container();
  for (const child of [new Container(), resources, chat]) document.addChild(child);
  return {
    children: [document],
    layoutRoot: new VStack([new ScrollView(document, { primary: true, scrollbar })]),
    terminal: { columns: 40, rows: 30 },
  } as unknown as TUI;
}

test("collectPrompts counts rows at the transcript width, left of an always-on scrollbar", () => {
  // 40 columns fit on one line at the terminal width and wrap to two beside the scrollbar.
  const tui = transcriptTui(new Text("x".repeat(40), 0, 0), "always");

  const result = collectPrompts(tui);

  assert.ok(!(result instanceof Error));
  assert.equal(result.prompts[0].row, 2);
});

test("collectPrompts reports a TUI without a transcript scroll view", () => {
  const tui = transcriptTui(new Container(), "always") as unknown as { layoutRoot: unknown };
  tui.layoutRoot = new VStack();

  const result = collectPrompts(tui as unknown as TUI);

  assert.ok(result instanceof Error);
  assert.match(result.message, /no transcript scroll view/);
});

test("collectPrompts reports a scroll view without a content height", () => {
  const view = new ScrollView(new Container(), { primary: true });
  Object.defineProperty(view, "contentHeight", { value: undefined });
  const tui = { children: [], layoutRoot: new VStack([view]), terminal: { columns: 40, rows: 30 } } as unknown as TUI;

  const result = collectPrompts(tui);

  assert.ok(result instanceof Error);
  assert.match(result.message, /no content height/);
});

test("collectPrompts reuses the previous walk until a chat child, the width or the content height changes", () => {
  let answerLines = 1;
  const chat = new Container();
  chat.addChild(new UserMessageComponent("first"));
  chat.addChild({ render: () => Array.from({ length: answerLines }, () => "answer"), invalidate() {} });
  chat.addChild(new UserMessageComponent("second"));
  const document = new Container();
  for (const child of [new Container(), new Container(), chat]) document.addChild(child);
  const view = new ScrollView(document, { primary: true });
  const terminal = { columns: 40, rows: 30 };
  const tui = { children: [document], layoutRoot: new VStack([view]), terminal } as unknown as TUI;
  // Pi lays the document out before the overlays read it.
  const layOut = () => view.updateLayout(document.render(view.getContentWidth(terminal.columns)).length, 30, () => {});
  const collect = (previous?: Transcript) => {
    const result = collectPrompts(tui, previous);
    assert.ok(!(result instanceof Error));
    return result;
  };

  layOut();
  const first = collect();
  assert.equal(collect(first), first);

  answerLines = 3;
  layOut();
  const taller = collect(first);
  assert.equal(taller.prompts[1].row, first.prompts[1].row + 2);
  assert.equal(collect(taller), taller);

  chat.addChild(new UserMessageComponent("third"));
  const added = collect(taller);
  assert.equal(added.prompts.length, 3);

  terminal.columns = 30;
  assert.notEqual(collect(added), added);
});

test("asScrollable ignores a TUI without scrollBy", () => {
  const tui = { viewportTop: 0 } as unknown as TUI;

  assert.equal(asScrollable(tui), undefined);
});

test("asScrollable accepts a fullscreen TUI", () => {
  const tui = { viewportTop: 0, scrollBy: () => {}, hasActiveSelection: () => false } as unknown as TUI;

  assert.equal(asScrollable(tui), tui);
});
