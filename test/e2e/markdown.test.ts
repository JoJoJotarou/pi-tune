import assert from "node:assert/strict";
import test from "node:test";
import { type Scenario, startPi } from "./harness.ts";

const answer = [
  "## Changes",
  "",
  "### 1. Command handling",
  "",
  "- Output goes through `notify`, see [extension docs](https://github.com/earendil-works/pi/blob/main/docs/extensions.md).",
  "- Frequent updates use `setStatus`.",
  "",
  "#### Notes",
  "",
  "| Tool | Language | UI library | Grouping |",
  "|---|---|---|---|",
  "| Grok Build | Rust | ratatui | verb group |",
  "| Codex CLI | Rust | ratatui | Explored |",
  "| Gemini CLI | TypeScript | Ink | dense tool rows |",
].join("\n");

const scenario: Scenario = {
  turns: [[{ text: answer }]],
};

for (const tune of [true, false]) {
  for (const cols of [100, 50]) {
    const label = `${tune ? "after" : "before"} at ${cols}x40`;
    test(`markdown rewrites (${label})`, { timeout: 180_000 }, async () => {
      const pi = await startPi({ scenario, tune, cols, rows: 40 });
      try {
        pi.type("review it\r");
        // Wait for the finished form: the box table or, when rewritten, the list rows.
        await pi.waitFor(tune && cols === 50 ? "- Grok Build" : "┌");
        const rows = pi.screen();
        const screen = rows.join("\n");

        if (tune) {
          assert.ok(!rows.some((row) => /^#{3,4}/.test(row)), screen);
          assert.ok(
            rows.some((row) => row.trim() === "1. Command handling"),
            screen,
          );
          if (cols === 100) {
            assert.ok(
              rows.some((row) => row.includes("see extension docs ↗ github.com")),
              screen,
            );
            assert.ok(screen.includes("┌"), screen);
          } else {
            assert.ok(
              rows.some((row) => row.trimStart().startsWith("- Grok Build — Language: Rust")),
              screen,
            );
            assert.ok(!screen.includes("┌"), screen);
          }
        }

        await pi.shot(`markdown-${tune ? "after" : "before"}-${cols}`);
      } finally {
        await pi.close();
      }
    });
  }
}

const longCode = Array.from({ length: 64 }, (_, index) => `const value${index + 1} = ${index + 1};`);
const longAnswer = ["Here is the code:", "", "```ts", ...longCode, "```", "", "All done."].join("\n");
const foldScenario: Scenario = { turns: [[{ text: longAnswer }]] };

test("long code blocks fold and open in the viewer", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: foldScenario, cols: 100, rows: 40, tune: true });
  try {
    pi.type("run it\r");
    await pi.waitFor("┄ 52 more lines");
    const rows = pi.screen();
    const screen = rows.join("\n");
    const codeRows = rows.filter((row) => /^const value\d+ = \d+;$/.test(row.trim()));
    assert.equal(codeRows.length, 12, screen);
    await pi.shot("code-fold");

    pi.type("\x1bo");
    await pi.waitFor("ts code · 64 lines");
    await pi.shot("code-fold-viewer");
  } finally {
    await pi.close();
  }

  const before = await startPi({ scenario: foldScenario, cols: 100, rows: 40, tune: false });
  try {
    before.type("run it\r");
    await before.waitFor("const value64 = 64;");
    await before.shot("code-fold-before");
  } finally {
    await before.close();
  }
});
