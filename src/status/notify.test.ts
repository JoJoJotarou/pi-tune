import assert from "node:assert/strict";
import test from "node:test";
import { notificationSequence, shouldNotify } from "./notify.ts";

test("notifies at 15 seconds or later", () => {
  assert.equal(shouldNotify(14_999, false), false);
  assert.equal(shouldNotify(15_000, false), true);
  assert.equal(shouldNotify(120_000, false), true);
});

test("an aborted run never notifies", () => {
  assert.equal(shouldNotify(120_000, true), false);
  assert.equal(shouldNotify(15_000, true), false);
});

test("uses OSC 777 by default", () => {
  assert.equal(notificationSequence("pi", "Done in 15.0s", {}), "\x1b]777;notify;pi;Done in 15.0s\x07");
});

test("uses OSC 99 under Kitty", () => {
  assert.equal(
    notificationSequence("pi", "Done in 15.0s", { KITTY_WINDOW_ID: "1" }),
    "\x1b]99;i=1:d=0;pi\x1b\\\x1b]99;i=1:p=body;Done in 15.0s\x1b\\",
  );
});
