import assert from "node:assert/strict";
import test from "node:test";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

const LABEL = "◆ Thinking · click to expand";

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

function rows(screen: string[]): string[] {
  return screen.map((row) => row.trim());
}

function countRows(lines: string[], text: string): number {
  return lines.filter((line) => line.includes(text)).length;
}

function assertHidden(lines: string[], why: string): void {
  assert.equal(countRows(lines, LABEL), 2, `both labels expected (${why}):\n${lines.join("\n")}`);
  assert.equal(countRows(lines, "ctrl+t"), 0, `the label carries no key hint (${why}):\n${lines.join("\n")}`);
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

test("thinking follows pi's hidden switch", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, tune: true, settings: { hideThinkingBlock: true } });
  await closeAfter(pi, async () => {
    pi.type("one\r");
    await pi.waitFor("First answer.");
    pi.type("two\r");
    await pi.waitFor("Second answer.");

    assertHidden(rows(pi.screen()), "after both turns");
    await pi.shot("thinking-hidden");

    pi.clickText(LABEL, 1);
    await pi.waitFor(/◆ Thought for \d/);
    let lines = rows(pi.screen());
    assert.equal(countRows(lines, "◆ Thought"), 1, `one summary expected:\n${lines.join("\n")}`);
    assert.equal(countRows(lines, LABEL), 1, `second run stays hidden:\n${lines.join("\n")}`);
    for (const thinking of [...firstLines, ...secondLines]) {
      assert.ok(!lines.some((line) => line.includes(thinking)), `thinking text leaked: ${thinking}`);
    }
    await pi.shot("thinking-one-open");

    pi.press("ctrl+t");
    await pi.waitForGone(LABEL);
    lines = rows(pi.screen());
    assert.equal(countRows(lines, LABEL), 0, `ctrl+t shows both runs:\n${lines.join("\n")}`);
    assert.ok(countRows(lines, "◆ Thought") === 2, `both headers expected:\n${lines.join("\n")}`);

    pi.press("ctrl+t");
    await pi.waitFor(LABEL);
    assertHidden(rows(pi.screen()), "after ctrl+t twice");

    pi.press("ctrl+o");
    await new Promise((done) => setTimeout(done, 1000));
    assertHidden(rows(pi.screen()), "after ctrl+o");
  });
});

test("a streaming visible run shows the rolling line then the summary", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: streamingScenario, tune: true, settings: { hideThinkingBlock: false } });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor(/◆ Think: /);
    await pi.shot("thinking-streaming");
    await pi.waitFor("All set.");
    const lines = rows(pi.screen());
    assert.equal(countRows(lines, "◆ Thought"), 1, `finished summary expected:\n${lines.join("\n")}`);
    assert.equal(countRows(lines, "◆ Think: "), 0, `rolling line must be gone:\n${lines.join("\n")}`);
    assert.equal(countRows(lines, LABEL), 0, `hidden label must not appear:\n${lines.join("\n")}`);
  });
});
