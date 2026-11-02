import assert from "node:assert/strict";
import { test } from "node:test";
import { hintFor } from "./hints.ts";

const keys = { interrupt: "ctrl+c", followUp: "alt+enter" };
const all = { stash: true, view: true };
const none = { stash: false, view: false };

test("idle hints name commands, files, shell, stash and viewer", () => {
  assert.equal(hintFor("idle", keys, all), "/ commands · @ files · ! shell · ctrl+s stash · alt+o view");
});

test("running hints name stop, steer, queue and viewer", () => {
  assert.equal(hintFor("running", keys, all), "ctrl+c stop · enter steer · alt+enter queue · alt+o view");
});

test("hints drop keys whose extension is disabled", () => {
  assert.equal(hintFor("idle", keys, none), "/ commands · @ files · ! shell");
  assert.equal(hintFor("idle", keys, { stash: false, view: true }), "/ commands · @ files · ! shell · alt+o view");
  assert.equal(hintFor("idle", keys, { stash: true, view: false }), "/ commands · @ files · ! shell · ctrl+s stash");
  assert.equal(hintFor("running", keys, none), "ctrl+c stop · enter steer · alt+enter queue");
  assert.equal(hintFor("running", keys, { stash: true, view: false }), "ctrl+c stop · enter steer · alt+enter queue");
});
