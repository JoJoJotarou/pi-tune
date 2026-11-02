import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { asScrollable, collectPrompts } from "./transcript.ts";

initTheme("dark", false);

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
