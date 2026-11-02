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
  ],
};

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function rowOf(pi: PiSession, text: string): number {
  return pi.screen().findIndex((line) => line.includes(text));
}

async function waitForRow(pi: PiSession, text: string, expectedRows: number[], timeoutMs = 20_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = rowOf(pi, text);
    if (expectedRows.includes(row)) return row;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForRow timed out: ${text} not at row ${expectedRows.join(" or ")}\n${pi.screen().join("\n")}`,
      );
    }
    await sleep(50);
  }
}

test("page flip keeps a new prompt at the top and resumes following", { timeout: 240_000 }, async () => {
  const pi = await startPi({ scenario, cols, rows, tune: true });
  try {
    pi.type("first question\r");
    await pi.waitFor("first answer line 40");

    pi.type("second question\r");
    await waitForRow(pi, "second question", [0, 1]);
    await pi.shot("flip-after-send");

    await pi.waitFor("second answer line 4");
    assert.ok([0, 1].includes(rowOf(pi, "second question")), `prompt left the top\n${pi.screen().join("\n")}`);
    await pi.shot("flip-short-answer");

    pi.type("third question\r");
    await pi.waitFor("third answer line 60");
    assert.ok(rowOf(pi, "third answer line 60") >= 0, `last answer line is not visible\n${pi.screen().join("\n")}`);

    for (let i = 0; i < 10; i++) {
      const screen = pi.screen();
      const inMiddle = screen.some((line) => line.includes("third answer line 30"));
      const promptGone = !screen.some((line) => line.trim() === "third question");
      if (inMiddle && promptGone) break;
      pi.press("pageup");
      await sleep(200);
    }
    const first = pi.screen()[0];
    assert.ok(first.includes("› ") && first.includes("prompt 3"), `sticky prompt missing\n${pi.screen().join("\n")}`);
    await pi.shot("sticky-prompt");
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
    await pi.shot("flip-before");
    assert.ok(rowOf(pi, "second question") > 1, `prompt is at the top without pi-tune\n${pi.screen().join("\n")}`);
  } finally {
    await pi.close();
  }
});
