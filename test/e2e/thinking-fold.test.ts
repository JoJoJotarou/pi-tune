/**
 * Spike for the thinking redesign: fold a thinking block when it settles (`thinking_end`) by calling the public
 * methods on its `AssistantMessageComponent`, then check the fold survives a terminal resize.
 *
 * `tune: false` keeps pi-tune out of the way: with its markdown transformer loaded the thinking text never reaches
 * the screen, so "the block is folded" and "the block shows its text" would not be distinguishable.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { type Scenario, startPi } from "./harness.ts";

const FOLD_LABEL = "◆ Spike fold";

const thinkingLines = ["Read the first request carefully.", "Find the smallest change.", "Check the surrounding code."];

const scenario: Scenario = {
  turns: [[{ thinking: thinkingLines.join("\n") }, { text: "First answer." }]],
  tokensPerSecond: 40,
};

function rows(screen: string[]): string[] {
  return screen.map((row) => row.trim());
}

function visible(lines: string[], text: string): boolean {
  return lines.some((line) => line.includes(text));
}

test("a fold applied at thinking_end survives a resize", { timeout: 180_000 }, async () => {
  const pi = await startPi({
    scenario,
    tune: false,
    extensions: [join(import.meta.dirname, "fold-spike.ts")],
    settings: { hideThinkingBlock: false },
  });
  try {
    pi.type("go\r");
    await pi.waitFor("First answer.");
    await pi.settle();

    let lines = rows(pi.screen());
    assert.ok(visible(lines, FOLD_LABEL), `the block folded at thinking_end:\n${pi.screen().join("\n")}`);
    for (const thinking of thinkingLines) {
      assert.ok(!visible(lines, thinking), `the folded block hides its text: ${thinking}`);
    }
    await pi.shot("fold-spike-folded");

    await pi.resize(80, 30);
    lines = rows(pi.screen());
    assert.equal(lines.length, 30, "the screen reads the new height");

    const survived = visible(lines, FOLD_LABEL);
    const leaked = thinkingLines.filter((thinking) => visible(lines, thinking));
    await pi.shot("fold-spike-resized");
    assert.ok(
      survived && leaked.length === 0,
      `the fold ${survived ? "survived" : "was lost"} the resize; visible thinking lines: ${JSON.stringify(leaked)}\n${pi.screen().join("\n")}`,
    );

    // The folded component still answers a click after the resize, and shows pi's own text when open.
    pi.clickText(FOLD_LABEL);
    await pi.waitForGone(FOLD_LABEL);
    await pi.waitFor(thinkingLines[0]);
    await pi.shot("fold-spike-opened");
  } finally {
    await pi.close();
  }
});
