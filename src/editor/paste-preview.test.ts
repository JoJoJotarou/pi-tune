import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { PastePreview, type PastePreviewAction } from "./paste-preview.ts";

initTheme("dark", false);

const theme = testTheme();
const plain = (line: string) => stripTerminalSequences(line);
const content = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");

function preview(rows = 40): { modal: PastePreview; actions: (PastePreviewAction | undefined)[] } {
  const actions: (PastePreviewAction | undefined)[] = [];
  return { modal: new PastePreview(theme, 1, content, rows, (action) => actions.push(action)), actions };
}

test("the preview is the viewer's rounded modal", () => {
  const lines = preview().modal.render(60).map(plain);
  assert.match(lines[0] ?? "", /^╭─ paste #1 ─+ 30 lines · \d+ B ─╮$/);
  assert.ok(lines[1]?.startsWith("│ line 1"), lines[1]);
  assert.match(lines[lines.length - 1] ?? "", /^╰─ e expand · d delete · ↑↓ scroll · esc close ─+╯$/);
});

test("the body keeps the modal open at 60% of the terminal", () => {
  const short = new PastePreview(theme, 2, "a\nb\nc", 40, () => {});
  const lines = short.render(60);
  assert.equal(lines.length, 22 + 2);
  assert.ok(plain(lines[3] ?? "").startsWith("│ c"), plain(lines[3] ?? ""));
  assert.ok(plain(lines[22] ?? "").startsWith("│  "), plain(lines[22] ?? ""));
  assert.equal(preview(40).modal.render(60).length, 30 + 2);
});

test("every modal line is exactly the width it was given", () => {
  for (const width of [40, 100]) {
    for (const line of preview().modal.render(width)) assert.equal(visibleWidth(line), width);
  }
});

test("scrolling moves the body and stops at the end", () => {
  const long = Array.from({ length: 100 }, (_, i) => `row ${i + 1}`).join("\n");
  const modal = new PastePreview(theme, 3, long, 40, () => {});
  modal.render(60);
  for (let i = 0; i < 40; i++) modal.handleInput("\x1b[B");
  assert.ok(plain(modal.render(60)[1] ?? "").startsWith("│ row 41"), plain(modal.render(60)[1] ?? ""));
});

test("keys report expand, delete and close", () => {
  const { modal, actions } = preview();
  modal.handleInput("e");
  modal.handleInput("d");
  modal.handleInput("\x1b");
  assert.deepEqual(actions, ["expand", "delete", undefined]);
});
