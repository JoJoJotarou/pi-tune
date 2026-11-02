import assert from "node:assert/strict";
import test from "node:test";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

const thinkingLines = [
  "Read the request carefully.",
  "Find the smallest change.",
  "Check the surrounding code.",
  "Write the edit.",
  "Run the checks.",
  "Report the result.",
];

const scenario: Scenario = {
  turns: [[{ thinking: thinkingLines.join("\n") }, { text: "All set." }]],
  tokensPerSecond: 40,
};

function rows(screen: string[]): string[] {
  return screen.map((row) => row.trim());
}

function rowIndex(lines: string[], matcher: string | RegExp): number {
  return lines.findIndex((line) => (typeof matcher === "string" ? line.includes(matcher) : matcher.test(line)));
}

async function closeAfter(pi: PiSession, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } finally {
    await pi.close();
  }
}

test("thinking folds to one line, expands with tool output", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, tune: true });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor("◆ Thinking");
    await pi.shot("thinking-streaming");

    await pi.waitFor("All set.");
    const lines = rows(pi.screen());

    const thought = rowIndex(lines, /◆ Thought .* · 6 lines$/);
    assert.ok(thought >= 0, `folded thinking row not found:\n${lines.join("\n")}`);
    for (const thinking of thinkingLines) {
      assert.ok(rowIndex(lines, thinking) < 0, `thinking line is visible: ${thinking}\n${lines.join("\n")}`);
    }
    await pi.shot("thinking-after");

    pi.press("ctrl+o");
    await pi.waitFor(thinkingLines[0]);
    await pi.shot("thinking-expanded");

    pi.press("ctrl+o");
    await pi.waitFor(/◆ Thought .* · 6 lines/);
    await pi.waitForGone(thinkingLines[0]);

    pi.clickText("◆ Thought");
    await pi.waitFor("Thinking...");
    pi.clickText("Thinking...");
    await pi.waitFor("◆ Thought");
  });
});

test("thinking before pi-tune", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, tune: false });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor("All set.");
    const lines = rows(pi.screen());
    for (const thinking of thinkingLines) {
      assert.ok(rowIndex(lines, thinking) >= 0, `thinking line missing:\n${lines.join("\n")}`);
    }
    await pi.shot("thinking-before");
  });
});
