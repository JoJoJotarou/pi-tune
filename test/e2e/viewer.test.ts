import assert from "node:assert/strict";
import test from "node:test";
import { type Scenario, startPi } from "./harness.ts";

const cols = 100;
const rows = 40;

const code = Array.from({ length: 30 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n");

const scenario: Scenario = {
  files: { "README.md": "# demo\n" },
  turns: [
    [{ tool: "bash", args: { command: "seq 1 60" } }],
    [{ text: `Here is the code:\n\n\`\`\`ts\n${code}\n\`\`\`\n\nAll done.` }],
    [{ tool: "bash", args: { command: "printf 'one\\ntwo\\nthree\\n'" } }],
  ],
};

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

test("viewer opens the latest block, switches, scrolls, searches, and closes", { timeout: 240_000 }, async () => {
  const pi = await startPi({ scenario, cols, rows, tune: true });
  try {
    pi.type("run it\r");
    await pi.waitFor("All done.");

    pi.type("\x1bo");
    await pi.waitFor("ts code");
    await pi.waitFor("1–30/30");
    await pi.waitFor("↑↓ scroll · / search · y copy · [ ] prev/next · esc close");
    assert.ok(
      pi.screen().some((line) => line.trimStart().startsWith("╭─ ")),
      pi.screen().join("\n"),
    );
    await pi.shot("viewer-long");

    pi.type("[");
    await pi.waitFor("bash · seq 1 60");
    await pi.waitFor("1–34/60");
    pi.press("pagedown");
    await pi.waitFor("27–60/60");
    await pi.shot("viewer-bash");

    pi.type("/42");
    await pi.waitFor("/42");
    await pi.shot("viewer-search");
    pi.type("\r");
    await pi.waitFor("25–58/60");
    assert.ok(
      pi.screen().some((line) => line.includes("42")),
      pi.screen().join("\n"),
    );

    pi.press("escape");
    await sleep(200);
    pi.press("escape");
    await pi.waitForGone("↑↓ scroll");
    await pi.waitFor("All done.");
    await sleep(300);

    pi.type("short\r");
    await pi.waitFor("three");
    await sleep(500);
    pi.type("\x1bo");
    await pi.waitFor("bash · printf");
    await pi.waitFor("1–3/3");

    // A three-line block still opens a window at least 60% of the terminal tall.
    const screen = pi.screen();
    const top = screen.findIndex((line) => line.includes("bash · printf"));
    const bottom = screen.findIndex((line) => line.includes("esc close"));
    assert.ok(top >= 0 && bottom > top, screen.join("\n"));
    assert.ok(bottom - top + 1 >= Math.ceil(rows * 0.6), `${bottom - top + 1} rows\n${screen.join("\n")}`);
    await pi.shot("viewer-short");

    pi.press("escape");
    await pi.waitForGone("↑↓ scroll");
  } finally {
    await pi.close();
  }
});
