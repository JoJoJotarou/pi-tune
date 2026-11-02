import assert from "node:assert/strict";
import test from "node:test";
import { type Scenario, startPi } from "./harness.ts";

const code = Array.from({ length: 30 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n");

const scenario: Scenario = {
  files: { "README.md": "# demo\n" },
  turns: [
    [{ tool: "bash", args: { command: "seq 1 60" } }],
    [{ text: `Here is the code:\n\n\`\`\`ts\n${code}\n\`\`\`\n\nAll done.` }],
  ],
};

test("viewer opens the latest block, switches, scrolls, searches, and closes", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols: 100, rows: 40, tune: true });
  try {
    pi.type("run it\r");
    await pi.waitFor("All done.");

    pi.type("\x1bo");
    await pi.waitFor("ts code");
    await pi.waitFor("1–");
    await pi.waitFor("/30");
    await pi.shot("viewer-code");

    pi.type("[");
    await pi.waitFor("bash · seq 1 60");
    pi.press("pagedown");
    await pi.waitFor("31–60/60");
    await pi.shot("viewer-bash");

    pi.type("/42\r");
    await pi.waitFor("27–56/60");
    assert.ok(
      pi.screen().some((line) => line.includes("42")),
      pi.screen().join("\n"),
    );

    pi.press("escape");
    await new Promise((done) => setTimeout(done, 200));
    pi.press("escape");
    await pi.waitForGone("↑↓ scroll");
    await pi.waitFor("All done.");
    await new Promise((done) => setTimeout(done, 300));

    pi.type("/view\r");
    await pi.waitFor("ts code");
    assert.ok(
      pi.screen().some((line) => line.includes("1–30/30")),
      pi.screen().join("\n"),
    );
  } finally {
    await pi.close();
  }
});
