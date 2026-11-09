/**
 * The fold is state on `AssistantMessageComponent`, so it only holds while pi keeps that component. These tests pin
 * what each transcript event does to it: a relayout keeps the fold, and a reload rebuilds the transcript, so the
 * session folds what it finds again — without the measured time, which only the live run knew.
 *
 * Compaction cannot be scripted here: pi refuses to compact a session as small as a scenario ("Nothing to compact")
 * and a real one would need a context near the model window. It rebuilds the transcript the way a reload does.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

const OPEN_LABEL = "◆ Thinking · click to expand";

const thinkingLines = ["Read the first request carefully.", "Find the smallest change.", "Check the surrounding code."];

const scenario: Scenario = {
  turns: [[{ thinking: thinkingLines.join("\n") }, { text: "First answer." }]],
  tokensPerSecond: 40,
};

function rows(screen: string[]): string[] {
  return screen.map((row) => row.trim());
}

function foldedLabels(lines: string[]): string[] {
  return lines.filter((line) => /◆ Thought for \d/.test(line));
}

function visibleThinking(lines: string[]): string[] {
  return thinkingLines.filter((thinking) => lines.some((line) => line.includes(thinking)));
}

async function closeAfter(pi: PiSession, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } finally {
    await pi.close();
  }
}

test("a folded block survives a resize and still opens", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, tune: true, settings: { hideThinkingBlock: false } });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor("First answer.");
    await pi.settle();
    assert.equal(foldedLabels(rows(pi.screen())).length, 1, `folded after the run:\n${pi.screen().join("\n")}`);
    assert.deepEqual(visibleThinking(rows(pi.screen())), []);

    await pi.resize(80, 30);
    assert.equal(rows(pi.screen()).length, 30, "the screen reads the new height");
    const resized = rows(pi.screen());
    assert.equal(foldedLabels(resized).length, 1, `still folded after the resize:\n${resized.join("\n")}`);
    assert.deepEqual(visibleThinking(resized), []);
    await pi.shot("thinking-fold-resized");

    pi.clickText("◆ Thought for");
    await pi.waitFor(thinkingLines[0]);
    assert.equal(foldedLabels(rows(pi.screen())).length, 0, "the click opens pi's own text");
  });
});

test("a reload folds the rebuilt transcript without a measured time", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, tune: true, settings: { hideThinkingBlock: true } });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor("First answer.");
    await pi.settle();
    assert.equal(foldedLabels(rows(pi.screen())).length, 1, `folded after the run:\n${pi.screen().join("\n")}`);

    pi.type("/reload\r");
    await pi.waitFor(/Reloaded/);
    await pi.waitFor("First answer.");
    await pi.settle();

    // The rebuilt transcript is folded again, but its measured run is gone, so it claims no time and no stale number
    // is left behind.
    const reloaded = rows(pi.screen());
    assert.equal(foldedLabels(reloaded).length, 0, `no stale duration label:\n${reloaded.join("\n")}`);
    assert.equal(
      reloaded.filter((line) => line.trim() === "◆ Thought").length,
      1,
      `the block is folded again:\n${reloaded.join("\n")}`,
    );
    assert.equal(reloaded.filter((line) => line.includes(OPEN_LABEL)).length, 0, reloaded.join("\n"));
    assert.deepEqual(visibleThinking(reloaded), []);
    await pi.shot("thinking-fold-reloaded");
  });
});
