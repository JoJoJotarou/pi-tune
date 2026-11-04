import assert from "node:assert/strict";
import test from "node:test";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

// The ghost suggestion's own request consumes the next scripted response, so the scenarios queue
// a stub turn for it.
const GHOST = "Run the test suite and report failures";
const scenario: Scenario = {
  turns: [[{ text: "First answer." }], [{ text: GHOST }]],
  tokensPerSecond: 2000,
};

/** Suggestions are off unless the agent dir turns them on. */
const suggestOn = { "pi-tune.json": JSON.stringify({ suggest: { enabled: true } }) };

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
    agentFiles: suggestOn,
  });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor("First answer.");
    // The suggestion request fires after the run settles; it consumes the queued stub turn.
    await pi.waitFor(GHOST);
    await pi.shot("suggestion-visible");

    // Tab fills the editor without submitting it.
    pi.press("tab");
    await pi.waitFor(new RegExp(`│${GHOST} +│`));
    await pi.shot("suggestion-filled");
    pi.type("x");
    await pi.waitFor(`${GHOST}x`);
  });
});

test("typing the start of the suggestion keeps the rest and right arrow completes it", {
  timeout: 120_000,
}, async () => {
  const pi = await startPi({ scenario, tune: true, agentFiles: suggestOn });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor(GHOST);
    pi.type("Run the");
    // The fake cursor sits between the typed start and the rest.
    await pi.waitFor(/│Run the {2}test suite and report failures +│/);
    pi.press("right");
    await pi.waitFor(new RegExp(`│${GHOST} +│`));
  });
});

test("clearing a typed start brings the whole suggestion back and esc dismisses it", { timeout: 120_000 }, async () => {
  const pi = await startPi({ scenario, tune: true, agentFiles: suggestOn });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor(GHOST);
    pi.type("Run x");
    await pi.waitForGone(GHOST);
    for (let i = 0; i < "Run x".length; i++) pi.press("backspace");
    await pi.waitFor(GHOST);
    pi.press("escape");
    await pi.waitForGone(GHOST);
  });
});

test("a double esc over a suggestion still opens Pi's session tree", { timeout: 120_000 }, async () => {
  const pi = await startPi({ scenario, tune: true, agentFiles: suggestOn });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor(GHOST);
    pi.press("escape");
    await pi.waitForGone(GHOST);
    pi.press("escape");
    await pi.waitFor("Session Tree");
  });
});

test("suggestions are off by default", { timeout: 120_000 }, async () => {
  const pi = await startPi({
    scenario: {
      turns: [[{ text: "First answer." }], [{ text: GHOST }], [{ text: "Second answer." }]],
      tokensPerSecond: 2000,
    },
    tune: true,
  });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor("First answer.");
    // With the request off, the second prompt consumes the turn the suggestion would have taken.
    pi.type("next\r");
    await pi.waitFor(GHOST);
    assert.ok(!pi.screen().some((row) => row.includes("Second answer.")));
  });
});

test("/suggest on turns suggestions on for the next run", { timeout: 120_000 }, async () => {
  const pi = await startPi({ scenario, tune: true });
  await closeAfter(pi, async () => {
    pi.type("/suggest on\r");
    await pi.waitFor("Next-step suggestions on · session model");
    pi.type("go\r");
    await pi.waitFor("First answer.");
    await pi.waitFor(GHOST);
  });
});

test("/suggest opens a settings panel that turns suggestions on and picks a model", { timeout: 120_000 }, async () => {
  const pi = await startPi({ scenario, tune: true });
  await closeAfter(pi, async () => {
    pi.type("/suggest\r");
    await pi.waitFor("Next-step suggestions");
    assert.ok(
      pi.screen().some((row) => row.includes("Next-step suggestions") && row.includes("off")),
      pi.screen().join("\n"),
    );

    pi.press("enter");
    await pi.waitFor("session model");
    assert.ok(
      pi.screen().some((row) => row.includes("Model") && row.includes("session model")),
      pi.screen().join("\n"),
    );

    pi.press("down");
    pi.press("enter");
    // Pi's own model selector, with its search input.
    await pi.waitFor("Only showing models from configured providers.");
    pi.type("scripted");
    await pi.waitFor("Model Name: scripted");
    pi.press("enter");
    await pi.waitFor("Next-step suggestions on · faux/scripted");
    assert.ok(
      pi.screen().some((row) => row.includes("Model") && row.includes("faux/scripted")),
      pi.screen().join("\n"),
    );

    pi.press("escape");
    await pi.waitForGone("Enter/Space to change");

    pi.type("go\r");
    await pi.waitFor("First answer.");
    await pi.waitFor(GHOST);
  });
});

test("the ghost is discarded by a bash command that starts no run", { timeout: 120_000 }, async () => {
  const pi = await startPi({
    scenario,
    tune: true,
    agentFiles: suggestOn,
  });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor("First answer.");
    await pi.waitFor(GHOST);
    pi.type("!echo $((40+2))\r");
    await pi.waitFor("42");
    await pi.waitForGone(GHOST);
  });
});

test("the ghost is discarded once a new prompt is submitted", { timeout: 120_000 }, async () => {
  const pi = await startPi({
    scenario: {
      turns: [
        [{ text: "First answer." }],
        [{ text: GHOST }],
        [{ text: `Second answer. ${"x".repeat(200)}` }],
        [{ text: "Next suggestion" }],
      ],
      tokensPerSecond: 100,
    },
    tune: true,
    agentFiles: suggestOn,
  });
  await closeAfter(pi, async () => {
    pi.type("go\r");
    await pi.waitFor("First answer.");
    await pi.waitFor(GHOST);
    pi.type("next\r");
    // The second answer is still streaming, so no new suggestion can have replaced the old one yet.
    await pi.waitFor("Second answer.");
    await pi.waitForGone(GHOST);
  });
});
