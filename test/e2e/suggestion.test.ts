import assert from "node:assert/strict";
import test from "node:test";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

// The ghost suggestion's own request consumes the next scripted response, so the scenario queues
// a stub turn for it.
const scenario: Scenario = {
  turns: [[{ text: "First answer." }], [{ text: "Run the test suite and report failures" }]],
  tokensPerSecond: 2000,
};

async function closeAfter(pi: PiSession, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } finally {
    await pi.close();
  }
}

test("the ghost suggestion fills on tab and hides while typing", { timeout: 120_000 }, async () => {
  const pi = await startPi({
    scenario,
    tune: true,
    env: { PI_TUNE_EDITOR_SUGGEST: "on" },
  });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor("First answer.");
    // The suggestion request fires after the run settles; it consumes the queued stub turn.
    await pi.waitFor("Run the test suite and report failures");
    await pi.shot("suggestion-visible");

    // Tab fills the editor without submitting it.
    pi.press("tab");
    await pi.waitFor(/│Run the test suite and report failures +│/);
    await pi.shot("suggestion-filled");
    await new Promise((done) => setTimeout(done, 500));
    pi.type("x");
    await new Promise((done) => setTimeout(done, 300));
    assert.ok(pi.screen().some((row) => row.includes("Run the test suite and report failuresx")));
  });
});

test("PI_TUNE_EDITOR_SUGGEST=off never shows a suggestion", { timeout: 120_000 }, async () => {
  const pi = await startPi({ scenario, tune: true });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor("First answer.");
    await new Promise((done) => setTimeout(done, 1000));
    const lines = pi.screen().map((row) => row.trim());
    assert.ok(!lines.some((line) => line.includes("Run the test suite and report failures")));
  });
});
