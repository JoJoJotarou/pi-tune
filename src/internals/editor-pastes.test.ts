import assert from "node:assert/strict";
import { test } from "node:test";
import { readEditorPaste } from "./editor-pastes.ts";

test("an editor without a paste store is an error", () => {
  for (const editor of [undefined, null, {}, { pastes: undefined }, { pastes: [] }]) {
    const result = readEditorPaste(editor, 1);
    assert.ok(result instanceof Error);
    assert.equal(result.message, "editor has no paste store");
  }
});

test("a paste store of the wrong shape is an error", () => {
  for (const pastes of [
    new Map<unknown, unknown>([["1", "text"]]),
    new Map<unknown, unknown>([[1, 42]]),
    new Map<unknown, unknown>([[null, "text"]]),
    new Map<unknown, unknown>([
      [1, "ok"],
      ["2", "text"],
    ]),
  ]) {
    const result = readEditorPaste({ pastes }, 1);
    assert.ok(result instanceof Error);
    assert.equal(result.message, "editor paste store has an unexpected shape");
  }
});

test("an id the store does not hold is an error naming it", () => {
  const result = readEditorPaste({ pastes: new Map([[1, "first"]]) }, 7);
  assert.ok(result instanceof Error);
  assert.equal(result.message, "paste #7 is not available");
});

test("a stored paste comes back as it was saved", () => {
  const pastes = new Map([
    [1, "first paste"],
    [2, "line one\nline two"],
  ]);
  assert.equal(readEditorPaste({ pastes }, 1), "first paste");
  assert.equal(readEditorPaste({ pastes }, 2), "line one\nline two");
});
