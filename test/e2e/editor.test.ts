import assert from "node:assert/strict";
import test from "node:test";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

const scenario: Scenario = {
  files: { "README.md": "# demo\n" },
  turns: [[{ text: "ready" }]],
};

const pasted = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");

async function waitForChange(pi: PiSession, previous: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const line = pi.screen().find((row) => row.includes("scripted · "));
    if (line && line !== previous) return line;
    if (Date.now() >= deadline) throw new Error(`border did not change from ${JSON.stringify(previous)}`);
    await new Promise((done) => setTimeout(done, 50));
  }
}

async function clearEditor(pi: PiSession): Promise<void> {
  for (let i = 0; i < 35; i++) {
    pi.press("ctrl+u");
    pi.press("backspace");
  }
}

test("the editor is a background block with a paste preview", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols: 100, rows: 30 });
  try {
    // 1. Typing lands inside the block, and the footer names the model.
    pi.type("hello");
    await pi.waitFor("hello");
    const block = pi.screen().find((row) => row.includes("❯ hello"));
    assert.match(block ?? "", /^ +❯ hello *$/, "the draft leads with the chevron");
    assert.ok(!pi.screen().join("\n").includes("╭"), "no box is drawn");
    await pi.waitFor(/scripted · \w+/);
    await pi.shot("editor-block");

    // 2. A short multi-line paste stays literal and grows the box.
    await clearEditor(pi);
    pi.paste("alpha\nbeta\ngamma");
    await pi.waitFor("gamma");
    assert.ok(pi.screen().join("\n").includes("alpha"));
    await pi.shot("editor-multiline");

    // 3. A large paste collapses into a marker; enter previews it in a modal.
    await clearEditor(pi);
    await pi.waitForGone("gamma");
    pi.paste(pasted);
    await pi.waitFor("[paste #1 +30 lines]");
    pi.press("left");
    pi.press("enter");
    await pi.waitFor("e expand · d delete · ↑↓ scroll · esc close");
    await pi.waitFor("paste #1");
    await pi.waitFor("30 lines");
    await pi.shot("paste-preview");
    pi.type("e");
    await pi.waitForGone("[paste #");
    await pi.waitFor("line 30");

    // 4. Double-clicking a marker opens the same preview; escape closes it.
    await clearEditor(pi);
    await pi.waitForGone("line 30");
    pi.paste(pasted);
    await pi.waitFor(/\[paste #\d+ \+30 lines\]/);
    pi.clickText("[paste #", 1, 2);
    await pi.waitFor("e expand · d delete · ↑↓ scroll · esc close");
    pi.press("escape");
    await pi.waitForGone("e expand · d delete · ↑↓ scroll · esc close");

    // 5. The border names the model and thinking level; shift+tab cycles thinking.
    await clearEditor(pi);
    const before = pi.screen().find((row) => row.includes("scripted · "));
    assert.ok(before, pi.screen().join("\n"));
    pi.press("shift+tab");
    const after = await waitForChange(pi, before);
    assert.notEqual(after, before);
  } finally {
    await pi.close();
  }
});

test("ctrl+s asks before it replaces a held stash", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols: 100, rows: 30 });
  try {
    pi.type("first draft");
    pi.press("ctrl+s");
    // The stash has no border label anymore: the footer hint names the key that restores it.
    await pi.waitFor("ctrl+s restore");
    assert.ok(!pi.screen().join("\n").includes("first draft"));

    pi.type("second draft");
    pi.press("ctrl+s");
    await pi.waitFor("ctrl+s again to replace stash");
    assert.ok(pi.screen().join("\n").includes("second draft"), "the draft was replaced without asking");
    await pi.shot("editor-stash-confirm");

    pi.press("ctrl+s");
    await pi.waitForGone("ctrl+s again to replace stash");
    await pi.waitForGone("second draft");
    pi.press("ctrl+s");
    await pi.waitFor("second draft");
    await pi.waitForGone("ctrl+s restore");
  } finally {
    await pi.close();
  }
});

test("the block holds at 40 columns", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols: 40, rows: 30 });
  try {
    pi.type("a narrow terminal still keeps the draft readable");
    await pi.waitFor("readable");
    const rows = pi.screen();
    const block = rows.filter((row) => row.startsWith(" ❯ ") || row.startsWith("   "));
    assert.ok(block.length >= 2, rows.join("\n"));
    assert.ok(!rows.some((row) => /[╭╮╰╯]/.test(row)), "no box at 40 columns");
    for (const row of rows) assert.ok(row.length <= 40, row);
    await pi.shot("editor-40-columns");
  } finally {
    await pi.close();
  }
});

test("enter right after a paste sends the message", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols: 100, rows: 30 });
  try {
    pi.paste(pasted);
    await pi.waitFor("[paste #1 +30 lines]");
    pi.press("enter");
    await pi.waitFor("ready");
    assert.ok(!pi.screen().join("\n").includes("e expand · d delete"));
    await pi.shot("editor-paste-enter-sends");
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
