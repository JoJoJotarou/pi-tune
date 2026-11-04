import assert from "node:assert/strict";
import test from "node:test";
import { type Scenario, startPi } from "./harness.ts";

const scenario: Scenario = {
  files: { "README.md": "# demo\n" },
  turns: [
    [{ text: "main answer one" }],
    [{ text: "side answer one" }],
    [{ text: "main answer two" }],
    [{ text: "side answer two" }],
  ],
};

test("a btw question answers in a drawer above the editor", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario });
  try {
    pi.type("first main question\r");
    await pi.waitFor("main answer one");

    pi.type("/btw what does the read tool do?\r");
    await pi.waitFor("side answer one");

    const screen = pi.screen().join("\n");
    assert.ok(screen.includes("btw · btw-"), screen);
    assert.ok(screen.includes("what does the read tool do?"), screen);
    assert.ok(screen.includes("side answer one"), screen);
    assert.ok(screen.includes("@turn 1 · main 1"), "the anchor is named in the title");
    assert.ok(screen.includes("ctrl+shift+b ask"), "the idle hints name the compose key");
    await pi.shot("btw-drawer");

    // A main turn after the thread started makes the drawer warn about what it cannot see.
    pi.type("second main question\r");
    await pi.waitFor("main answer two");
    await pi.waitFor("main turns 2-2 are not in this thread");
    await pi.shot("btw-drawer-stale");
  } finally {
    await pi.close();
  }
});
