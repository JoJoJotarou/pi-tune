import assert from "node:assert/strict";
import test from "node:test";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

const cols = 100;
const rows = 30;
const questions = ["first question", "second question", "third question", "fourth question"];

function answer(number: number): string {
  return [`answer ${number}`, ...Array.from({ length: 20 }, (_, i) => `${i + 1}. answer ${number} line ${i + 1}`)].join(
    "\n",
  );
}

const scenario: Scenario = {
  files: { "README.md": "# demo\n" },
  turns: questions.map((_, i) => [{ text: answer(i + 1) }]),
};

async function runTurns(pi: PiSession): Promise<void> {
  for (let i = 0; i < questions.length; i++) {
    pi.type(`${questions[i]}\r`);
    await pi.waitFor(`answer ${i + 1} line 20`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function lastColumn(pi: PiSession): { row: number; cell: string }[] {
  return pi.screen().map((line, row) => ({ row, cell: line.length >= cols ? line[cols - 1] : "" }));
}

async function waitForRow(pi: PiSession, text: string, expectedRows: number[], timeoutMs = 20_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = pi.screen().findIndex((line) => line.includes(text));
    if (expectedRows.includes(row)) return row;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForRow timed out: ${text} not at row ${expectedRows.join(" or ")}\n${pi.screen().join("\n")}`,
      );
    }
    await new Promise((done) => setTimeout(done, 50));
  }
}

test("timeline rail jumps to the first prompt", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols, rows, tune: true });
  try {
    await runTurns(pi);

    const ticks = lastColumn(pi).filter(({ cell }) => cell === "─" || cell === "━");
    assert.ok(ticks.length > 0, `no rail ticks in the last column\n${pi.screen().join("\n")}`);
    pi.click(cols - 1, ticks[0].row);

    await waitForRow(pi, "first question", [0, 1]);
    await pi.shot("timeline-rail");

    pi.type("/timeline\r");
    await pi.waitFor("Prompts in this session");
    await new Promise((done) => setTimeout(done, 200));
    await pi.shot("timeline-list");
    pi.press("down");
    pi.press("down");
    pi.press("enter");

    await waitForRow(pi, "third question", [0, 1]);
  } finally {
    await pi.close();
  }
});

test("timeline leaves the transcript unchanged without pi-tune", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols, rows, tune: false });
  try {
    await runTurns(pi);
    await pi.shot("timeline-before");

    const seen = new Set<string>();
    for (let i = 0; i < 12 && seen.size < questions.length; i++) {
      const screen = pi.screen().join("\n");
      for (const question of questions) if (screen.includes(question)) seen.add(question);
      if (seen.size === questions.length) break;
      pi.press("pageup");
      await sleep(200);
    }
    assert.deepEqual([...seen].sort(), [...questions].sort(), `missing prompts\n${pi.screen().join("\n")}`);
  } finally {
    await pi.close();
  }
});

test("timeline reports that it needs fullscreen mode outside fullscreen", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols, rows, tune: true, settings: { tuiMode: "regular" } });
  try {
    pi.type(`${questions[0]}\r`);
    await pi.waitFor("answer 1 line 20");

    pi.type("/timeline\r");
    await pi.waitFor("Timeline needs fullscreen mode");
    await pi.shot("timeline-regular");

    pi.type(`${questions[1]}\r`);
    await pi.waitFor("answer 2 line 20");
  } finally {
    await pi.close();
  }
});
