import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { asScrollable, collectPrompts, FlipSpacer } from "./transcript.ts";

initTheme("dark", false);

function flipTui() {
  const chat: { children: Component[]; render: () => string[] } = { children: [], render: () => [] };
  const document = {
    children: [{ render: () => [] }, { render: () => [] }, chat],
    render: () => [],
    addChild: () => {},
  };
  const tui = {
    children: [document],
    terminal: { columns: 80, rows: 30 },
    viewportTop: 0,
    scrollToBottomCalls: 0,
    scrollBy(lines: number) {
      tui.viewportTop += lines;
    },
    scrollToBottom() {
      tui.scrollToBottomCalls++;
    },
  };
  return { tui, chat };
}

function answerLines(count: number): Component {
  return { render: () => Array.from({ length: count }, () => "answer"), invalidate: () => {} };
}

test("collectPrompts reports a tree without the expected children", () => {
  const tui = {
    children: [{ render: () => [] }],
  } as unknown as TUI;

  const result = collectPrompts(tui, 40);

  assert.ok(result instanceof Error);
});

test("collectPrompts reports a document without a chat", () => {
  const tui = {
    children: [{ children: [{ render: () => [] }, { render: () => [] }] }],
  } as unknown as TUI;

  const result = collectPrompts(tui, 40);

  assert.ok(result instanceof Error);
});

test("asScrollable ignores a TUI without scrollBy", () => {
  const tui = { viewportTop: 0 } as unknown as TUI;

  assert.equal(asScrollable(tui), undefined);
});

test("asScrollable accepts a fullscreen TUI", () => {
  const tui = { viewportTop: 0, scrollBy: () => {} } as unknown as TUI;

  assert.equal(asScrollable(tui), tui);
});

test("a flip ended by scrolling never scrolls to bottom", async () => {
  const { tui, chat } = flipTui();
  const spacer = new FlipSpacer(tui as never, (error) => assert.fail(error.message));

  assert.deepEqual(spacer.render(80), []);
  chat.children.push(new UserMessageComponent("first question"));
  assert.ok(spacer.render(80).length > 0);
  await Promise.resolve();
  assert.equal(tui.viewportTop, 0);

  tui.viewportTop = 12;
  assert.deepEqual(spacer.render(80), []);
  chat.children.push(answerLines(60));
  spacer.render(80);
  await Promise.resolve();

  assert.equal(tui.scrollToBottomCalls, 0);
});

test("a flip ended by the answer filling the viewport scrolls to bottom", async () => {
  const { tui, chat } = flipTui();
  const spacer = new FlipSpacer(tui as never, (error) => assert.fail(error.message));

  spacer.render(80);
  chat.children.push(new UserMessageComponent("first question"));
  spacer.render(80);
  await Promise.resolve();
  chat.children.push(answerLines(60));
  spacer.render(80);
  await Promise.resolve();

  assert.equal(tui.scrollToBottomCalls, 1);
});
