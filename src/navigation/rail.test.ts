import assert from "node:assert/strict";
import test from "node:test";
import { nearestPrompt, railCells } from "./rail.ts";

const prompts = [{ row: 0 }, { row: 10 }, { row: 20 }];

test("places ticks at the scaled prompt rows", () => {
  const cells = railCells({ prompts, total: 100, viewportTop: 50, height: 10 });

  assert.deepEqual(cells, ["tick", "tick", "current", "empty", "empty", "thumb", "empty", "empty", "empty", "empty"]);
});

test("marks the prompt at or above the viewport as current", () => {
  const cells = railCells({ prompts, total: 100, viewportTop: 15, height: 10 });

  assert.equal(cells[1], "current");
});

test("falls back to the first prompt when the viewport is above every prompt", () => {
  const cells = railCells({ prompts: [{ row: 5 }], total: 100, viewportTop: 0, height: 10 });

  assert.equal(cells[0], "current");
});

test("spans the thumb over the viewport and lets ticks win", () => {
  const cells = railCells({ prompts: [{ row: 0 }, { row: 10 }], total: 20, viewportTop: 5, height: 10 });

  assert.deepEqual(cells, ["current", "empty", "thumb", "thumb", "thumb", "tick", "thumb", "thumb", "empty", "empty"]);
});

test("draws no cells when the transcript fits in the viewport", () => {
  assert.deepEqual(railCells({ prompts, total: 10, viewportTop: 0, height: 10 }), []);
});

test("draws no cells when there are no prompts", () => {
  assert.deepEqual(railCells({ prompts: [], total: 100, viewportTop: 0, height: 10 }), []);
});

test("nearestPrompt keeps the first prompt on a tie", () => {
  const candidates = [{ row: 0 }, { row: 20 }];

  assert.equal(nearestPrompt(candidates, 100, 10, 1), candidates[0]);
  assert.equal(nearestPrompt(candidates, 100, 10, 2), candidates[1]);
});
