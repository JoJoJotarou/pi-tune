import assert from "node:assert/strict";
import test from "node:test";
import { notificationDelivery, sendNotification, shouldNotify } from "./notify.ts";

test("notifies at 15 seconds or later", () => {
  assert.equal(shouldNotify(14_999, false), false);
  assert.equal(shouldNotify(15_000, false), true);
  assert.equal(shouldNotify(120_000, false), true);
});

test("an aborted run never notifies", () => {
  assert.equal(shouldNotify(120_000, true), false);
  assert.equal(shouldNotify(15_000, true), false);
});

test("uses OSC 777 under Ghostty and other terminals", () => {
  assert.deepEqual(notificationDelivery("pi", "Done in 15.0s", { TERM_PROGRAM: "ghostty" }, "darwin"), {
    kind: "sequence",
    sequence: "\x1b]777;notify;pi;Done in 15.0s\x07",
  });
  assert.equal(notificationDelivery("pi", "Done in 15.0s", { TERM_PROGRAM: "iTerm.app" }, "linux").kind, "sequence");
});

test("uses OSC 99 under Kitty", () => {
  assert.deepEqual(notificationDelivery("pi", "Done in 15.0s", { KITTY_WINDOW_ID: "1" }, "darwin"), {
    kind: "sequence",
    sequence: "\x1b]99;i=1:d=0;pi\x1b\\\x1b]99;i=1:p=body;Done in 15.0s\x1b\\",
  });
  assert.equal(notificationDelivery("pi", "x", { KITTY_WINDOW_ID: "1" }, "linux").kind, "sequence");
});

test("uses osascript on macOS when TERM_PROGRAM is zed, vscode or unset", () => {
  for (const env of [{ TERM_PROGRAM: "zed" }, { TERM_PROGRAM: "vscode" }, {}]) {
    assert.deepEqual(notificationDelivery("pi", "Done in 15.0s", env, "darwin"), {
      kind: "command",
      command: "osascript",
      args: ["-e", 'display notification "Done in 15.0s" with title "pi"'],
    });
  }
});

test("stays on OSC 777 on Linux when TERM_PROGRAM is unset", () => {
  assert.equal(notificationDelivery("pi", "Done in 15.0s", {}, "linux").kind, "sequence");
});

test("escapes quotes and backslashes in the AppleScript strings", () => {
  const delivery = notificationDelivery('a "b"', "c \\ d", { TERM_PROGRAM: "zed" }, "darwin");
  assert.deepEqual(delivery, {
    kind: "command",
    command: "osascript",
    args: ["-e", 'display notification "c \\\\ d" with title "a \\"b\\""'],
  });
});

test("writes the escape sequence to the terminal instead of spawning", async () => {
  const written: string[] = [];
  let spawned = false;
  await sendNotification("pi", "Done", {
    env: { TERM_PROGRAM: "ghostty" },
    platform: "darwin",
    write: (text) => written.push(text),
    run: () => {
      spawned = true;
    },
  });
  assert.deepEqual(written, ["\x1b]777;notify;pi;Done\x07"]);
  assert.equal(spawned, false);
});

test("spawns osascript with an argument array on macOS fallback terminals", async () => {
  const calls: [string, string[]][] = [];
  await sendNotification("pi", "Done", {
    env: { TERM_PROGRAM: "zed" },
    platform: "darwin",
    write: () => assert.fail("must not write to the terminal"),
    run: (command, args) => {
      calls.push([command, args]);
    },
  });
  assert.deepEqual(calls, [["osascript", ["-e", 'display notification "Done" with title "pi"']]]);
});
