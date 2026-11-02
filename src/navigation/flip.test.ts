import assert from "node:assert/strict";
import test from "node:test";
import { startFlip, updateFlip, userScrolled } from "./flip.ts";

test("a flip starts with enough padding to put the prompt at the viewport top", () => {
  const state = startFlip(10, 12, 30);

  assert.equal(state.padding, 28);
  assert.equal(state.done, false);
});

test("padding shrinks as the chat grows and the flip ends at zero", () => {
  const state = startFlip(10, 12, 30);

  assert.equal(updateFlip(state, 20).padding, 20);
  assert.equal(updateFlip(state, 32).padding, 8);

  const done = updateFlip(state, 40);
  assert.equal(done.padding, 0);
  assert.equal(done.done, true);
});

test("a chat that already fills the viewport starts done", () => {
  const state = startFlip(10, 40, 30);

  assert.equal(state.padding, 0);
  assert.equal(state.done, true);
  assert.equal(updateFlip(state, 60).done, true);
});

test("user scroll ends the flip without padding", () => {
  const state = userScrolled(startFlip(10, 12, 30));

  assert.equal(state.padding, 0);
  assert.equal(state.done, true);
});
