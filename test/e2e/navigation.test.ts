import assert from "node:assert/strict";
import test from "node:test";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

const cols = 100;
const rows = 30;

function numbered(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join("\n");
}

const scenario: Scenario = {
  files: { "README.md": "# demo\n" },
  tokensPerSecond: 60,
  turns: [
    [{ text: numbered("first answer line", 40) }],
    [{ text: numbered("second answer line", 4) }],
    [{ text: numbered("third answer line", 60) }],
    [{ text: numbered("fourth answer line", 40) }],
  ],
};

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function rowOf(pi: PiSession, text: string): number {
  return pi.screen().findIndex((line) => line.includes(text));
}

test("survives /new and still scrolls", { timeout: 240_000 }, async () => {
  const pi = await startPi({ scenario, cols, rows, tune: true });
  try {
    pi.type("first question\r");
    await pi.waitFor("first answer line 40");

    pi.type("/new\r");
    // The cleared transcript proves /new ran; no fixed settle delay.
    await pi.waitForGone("first answer line 40");

    pi.type("second question\r");
    // /new resets the faux provider, so the reply streams the first turn again.
    await pi.waitFor("first answer line 40");

    for (let i = 0; i < 4; i++) {
      pi.press("pageup");
      await sleep(150);
    }
    pi.type("\x1b[<64;50;10M");
    await sleep(200);
    pi.type("\x1b[<65;50;10M");
    await sleep(2000);

    // The footer names the model while Pi runs; a crashed runtime leaves it frozen or gone.
    await pi.waitFor("scripted", 2000);
    assert.ok(!pi.screen().join("\n").includes("stale"), `stale ctx crash\n${pi.screen().join("\n")}`);
    await pi.shot("after-new");
  } finally {
    await pi.close();
  }
});

test("without pi-tune a new prompt scrolls in at the bottom", { timeout: 240_000 }, async () => {
  const pi = await startPi({ scenario, cols, rows, tune: false });
  try {
    pi.type("first question\r");
    await pi.waitFor("first answer line 40");

    pi.type("second question\r");
    await pi.waitFor("second question");
    await sleep(300);
    await pi.shot("no-tune-new-prompt");
    assert.ok(rowOf(pi, "second question") > 1, `prompt is at the top without pi-tune\n${pi.screen().join("\n")}`);
  } finally {
    await pi.close();
  }
});
