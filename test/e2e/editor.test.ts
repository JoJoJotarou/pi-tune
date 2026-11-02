import assert from "node:assert/strict";
import test from "node:test";
import { type Scenario, startPi } from "./harness.ts";

const scenario: Scenario = {
  files: { "README.md": "# demo\n" },
  turns: [[{ text: "ready" }]],
};

const pasted = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");

async function waitForChange(pi: Awaited<ReturnType<typeof startPi>>, previous: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const line = pi.screen().find((row) => row.includes("scripted · "));
    if (line && line !== previous) return line;
    if (Date.now() >= deadline) throw new Error(`border did not change from ${JSON.stringify(previous)}`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

test("editor paste, preview, stash and border", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols: 100, rows: 30 });
  try {
    // 1. A large bracketed paste collapses into a marker.
    pi.paste(pasted);
    await pi.waitFor("[paste #1 +30 lines]");
    await pi.shot("editor-paste-marker");

    // 2. Enter on the marker previews it; `e` expands it into the editor.
    pi.press("left");
    pi.press("enter");
    await pi.waitFor("paste #1 · 30 lines");
    await pi.shot("editor-paste-preview");
    pi.type("e");
    await pi.waitForGone("[paste #");
    await pi.waitFor("line 30");
    assert.ok(!pi.screen().join("\n").includes("[paste #"));

    // 3. Double-clicking a marker opens the preview; escape closes it.
    for (let i = 0; i < 35; i++) {
      pi.press("ctrl+u");
      pi.press("backspace");
    }
    await pi.waitForGone("line 30");
    pi.paste(pasted);
    await pi.waitFor(/\[paste #\d+ \+30 lines\]/);
    pi.clickText("[paste #", 1, 2);
    await pi.waitFor("e expand · d delete · esc close");
    pi.press("escape");
    await pi.waitForGone("e expand · d delete · esc close");

    // 4. ctrl+s stashes a draft and brings it back.
    pi.press("end");
    pi.press("ctrl+u");
    await pi.waitForGone("[paste #");
    pi.type("half written");
    pi.press("ctrl+s");
    await pi.waitFor("stashed");
    assert.ok(!pi.screen().join("\n").includes("half written"));
    await pi.shot("editor-stash");
    pi.press("ctrl+s");
    await pi.waitFor("half written");
    await pi.waitForGone("stashed");

    // 5. The border names the model and thinking level; shift+tab cycles thinking.
    const before = pi.screen().find((row) => row.includes("scripted · "));
    assert.ok(before, pi.screen().join("\n"));
    pi.press("shift+tab");
    const after = await waitForChange(pi, before);
    assert.notEqual(after, before);
    await pi.shot("editor-border");
  } finally {
    await pi.close();
  }
});

test("editor before tune", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, tune: false, cols: 100, rows: 30 });
  try {
    pi.paste(pasted);
    await pi.waitFor("[paste #1 +30 lines]");
    await pi.shot("editor-before");
  } finally {
    await pi.close();
  }
});
