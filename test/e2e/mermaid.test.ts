import assert from "node:assert/strict";
import test from "node:test";
import { type Scenario, startPi } from "./harness.ts";

const fit = [
  "Here is the flow:",
  "",
  "```mermaid",
  "flowchart TD",
  "  A[Start] --> B{Check}",
  "  B --> C[Done]",
  "```",
  "",
  "That is all.",
].join("\n");

const chain = Array.from({ length: 14 }, (_, index) => `N${index + 1}[Step ${index + 1}]`).join(" --> ");
const wide = ["Here is the chain:", "", "```mermaid", "flowchart LR", `  ${chain}`, "```", ""].join("\n");

const off = { markdown: { mermaid: "off" } };

const fitScenario: Scenario = { turns: [[{ text: fit }]] };
const wideScenario: Scenario = { turns: [[{ text: wide }]] };
const beforeScenario: Scenario = { turns: [[{ text: fit }]] };
const plainScenario: Scenario = { turns: [[{ text: "Just text, no diagram." }]] };

test("a fitting mermaid diagram renders art and an action row", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: fitScenario, cols: 100, rows: 40, tune: true, settings: off });
  try {
    pi.type("draw it\r");
    await pi.waitFor("open preview");
    const screen = pi.screen().join("\n");
    assert.ok(screen.includes("┌"), screen);
    assert.ok(screen.includes("◇ mermaid · flowchart"), screen);
    assert.ok(screen.includes("open preview"), screen);
    await pi.shot("mermaid-fit");
  } finally {
    await pi.close();
  }
});

test("a mermaid diagram wider than the terminal shows the needs line", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: wideScenario, cols: 100, rows: 40, tune: true, settings: off });
  try {
    pi.type("draw it\r");
    await pi.waitFor("needs");
    const screen = pi.screen().join("\n");
    assert.ok(screen.includes("◇ mermaid · flowchart"), screen);
    assert.ok(screen.includes("columns"), screen);
    assert.ok(screen.includes("open preview"), screen);
    await pi.shot("mermaid-wide");
  } finally {
    await pi.close();
  }
});

test("default settings notice appears after a mermaid answer", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: fitScenario, cols: 100, rows: 40, tune: true });
  try {
    pi.type("draw it\r");
    await pi.waitFor("pi-tune: set");
    const screen = pi.screen().join("\n").replace(/\s+/g, " ");
    assert.ok(screen.includes("diagram previews and source copy"), screen);
  } finally {
    await pi.close();
  }
});

test("default settings show no notice without a mermaid answer", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: plainScenario, cols: 100, rows: 40, tune: true });
  try {
    pi.type("say hi\r");
    await pi.waitFor("Just text, no diagram.");
    assert.ok(!pi.screen().join("\n").includes("pi-tune: set"));
  } finally {
    await pi.close();
  }
});

test("without pi-tune Pi draws the mermaid diagram itself", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: beforeScenario, cols: 100, rows: 40, tune: false });
  try {
    pi.type("draw it\r");
    await pi.waitFor("┌");
    await pi.shot("mermaid-before");
  } finally {
    await pi.close();
  }
});
