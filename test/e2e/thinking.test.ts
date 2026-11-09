import assert from "node:assert/strict";
import test from "node:test";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

const OPEN_LABEL = "◆ Thinking · click to expand";

const firstLines = [
  "Read the first request carefully.",
  "Find the smallest change.",
  "Check the surrounding code.",
  "Write the first edit.",
];

const secondLines = [
  "Read the second request carefully.",
  "Find the next smallest change.",
  "Check the surrounding code again.",
  "Write the second edit.",
];

const scenario: Scenario = {
  turns: [
    [{ thinking: firstLines.join("\n") }, { text: "First answer." }],
    [{ thinking: secondLines.join("\n") }, { text: "Second answer." }],
  ],
  tokensPerSecond: 40,
};

const streamingScenario: Scenario = {
  turns: [[{ thinking: [...firstLines, "Run the checks.", "Report the result."].join("\n") }, { text: "All set." }]],
  tokensPerSecond: 30,
};

/** Thinking takes well under a second here, while every reply claims nine seconds, as a long real reply would. */
const measuredScenario: Scenario = {
  turns: [[{ thinking: "Plan the answer briefly." }, { text: "Done thinking, here is the answer." }]],
  tokensPerSecond: 60,
  durationMs: 9_000,
};

function rows(screen: string[]): string[] {
  return screen.map((row) => row.trim());
}

function countRows(lines: string[], text: string): number {
  return lines.filter((line) => line.includes(text)).length;
}

/** The rows a settled block folds to, with their measured time. */
function foldedLabels(lines: string[]): string[] {
  return lines.filter((line) => /◆ Thought for \d/.test(line));
}

function assertNoThinkingText(lines: string[], why: string): void {
  for (const thinking of [...firstLines, ...secondLines]) {
    assert.ok(!lines.some((line) => line.includes(thinking)), `thinking line is visible (${why}): ${thinking}`);
  }
}

async function closeAfter(pi: PiSession, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } finally {
    await pi.close();
  }
}

test("every settled block folds to its measured time and opens to pi's text", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, tune: true, settings: { hideThinkingBlock: true } });
  await closeAfter(pi, async () => {
    pi.type("one\r");
    await pi.waitFor("First answer.");
    pi.type("two\r");
    await pi.waitFor("Second answer.");
    await pi.settle();

    const folded = rows(pi.screen());
    assert.equal(foldedLabels(folded).length, 2, `both blocks folded:\n${folded.join("\n")}`);
    assert.equal(countRows(folded, OPEN_LABEL), 0, `the measured label replaces the open hint:\n${folded.join("\n")}`);
    assertNoThinkingText(folded, "after both turns");
    await pi.shot("thinking-folded");

    pi.clickText("◆ Thought for", 1);
    await pi.waitFor(firstLines[0]);
    const opened = rows(pi.screen());
    for (const thinking of firstLines) {
      assert.ok(
        opened.some((line) => line.includes(thinking)),
        `the opened block shows pi's text: ${thinking}`,
      );
    }
    for (const thinking of secondLines) {
      assert.ok(!opened.some((line) => line.includes(thinking)), `the other block stays folded: ${thinking}`);
    }
    assert.equal(foldedLabels(opened).length, 1, `one block is open now:\n${opened.join("\n")}`);
    await pi.shot("thinking-one-open");

    pi.press("ctrl+t");
    await pi.waitFor(secondLines[0]);
    assert.equal(foldedLabels(rows(pi.screen())).length, 0, "ctrl+t opens every block");
    pi.press("ctrl+t");
    await pi.waitForGone(secondLines[0]);
    await pi.waitForGone(firstLines[0]);
    const refolded = rows(pi.screen());
    assert.equal(foldedLabels(refolded).length, 2, `ctrl+t folds every block again:\n${refolded.join("\n")}`);
  });
});

test("the label keeps the measured thinking time, not the whole reply's", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: measuredScenario, tune: true, settings: { hideThinkingBlock: false } });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    // The status area appends `Worked for` once the run settles, so message_end has been handled by then.
    await pi.waitFor(/Worked for/);
    await pi.settle();
    const label = foldedLabels(rows(pi.screen()))[0];
    assert.ok(label, `folded label expected:\n${pi.screen().join("\n")}`);
    assert.doesNotMatch(label, /Thought for 9\.0s/);
  });
});

test("a streaming run shows one rolling row, then folds to pi's text", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: streamingScenario, tune: true, settings: { hideThinkingBlock: false } });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor(/◆ Thinking · /);
    await pi.shot("thinking-streaming");
    const streaming = rows(pi.screen()).filter((row) => row.includes("◆ Thinking · "));
    assert.equal(streaming.length, 1, `one rolling row expected:\n${pi.screen().join("\n")}`);
    assert.ok(streaming[0].length > "◆ Thinking · ".length, `the row carries the newest words: ${streaming[0]}`);

    await pi.waitFor("All set.");
    await pi.settle();
    const lines = rows(pi.screen());
    assert.equal(countRows(lines, "◆ Thinking · "), 0, `rolling line must be gone:\n${lines.join("\n")}`);
    assert.equal(foldedLabels(lines).length, 1, `folded label expected:\n${lines.join("\n")}`);

    pi.clickText("◆ Thought for");
    await pi.waitFor(firstLines[0]);
    await pi.shot("thinking-open");
  });
});
