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
import { asScrollable, collectPrompts } from "./transcript.ts";

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

test("asScrollable ignores a TUI without scrollBy", () => {
  const tui = { viewportTop: 0 } as unknown as TUI;

  assert.equal(asScrollable(tui), undefined);
});

test("asScrollable accepts a fullscreen TUI", () => {
  const tui = { viewportTop: 0, scrollBy: () => {}, hasActiveSelection: () => false } as unknown as TUI;

  assert.equal(asScrollable(tui), tui);
});
