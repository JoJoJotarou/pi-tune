import assert from "node:assert/strict";
import { test } from "node:test";
import { hintFor } from "./hints.ts";

const keys = { interrupt: "ctrl+c", followUp: "alt+enter" };

test("idle hints name commands, files, shell, stash and viewer", () => {
  assert.equal(hintFor("idle", keys), "/ commands · @ files · ! shell · ctrl+s stash · alt+o view");
});

test("running hints name stop, steer, queue and viewer", () => {
  assert.equal(hintFor("running", keys), "ctrl+c stop · enter steer · alt+enter queue · alt+o view");
});
