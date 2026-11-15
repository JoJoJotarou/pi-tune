import assert from "node:assert/strict";
import { test } from "node:test";
import { BOTTOM_MARK, editorRows } from "./editor-layout.ts";

test("Pi's rows split into the top border, the draft, and what sits below the bottom border", () => {
  const rows = editorRows(["╭───╮", "│draft│", `${BOTTOM_MARK}╰───╯`, "menu one", "menu two"]);
  assert.deepEqual(rows, {
    top: "╭───╮",
    content: ["│draft│"],
    below: ["menu one", "menu two"],
  });
});

test("rows without the bottom border marker are an Error", () => {
  const rows = editorRows(["╭───╮", "│draft│", "╰───╯"]);
  assert.ok(rows instanceof Error);
  assert.equal(rows.message, "Pi's editor rows have no bottom border marker");
});

test("a marker before any top border is an Error", () => {
  const rows = editorRows([`${BOTTOM_MARK}╰───╯`, "menu one"]);
  assert.ok(rows instanceof Error);
  assert.equal(rows.message, "Pi's editor rows have no bottom border marker");
});
