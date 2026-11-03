import assert from "node:assert/strict";
import test from "node:test";
import { type Scenario, startPi } from "./harness.ts";

function toolScenario(): Scenario {
  return {
    files: { "README.md": "# demo\n" },
    turns: [[{ tool: "bash", args: { command: "sleep 3" } }], [{ text: "finished" }]],
  };
}

test("working line names the running bash tool", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: toolScenario() });
  try {
    pi.type("run it\r");
    await pi.waitFor(/bash sleep 3.*to stop/);
    const statusRow = pi.screen().find((row) => row.includes("to stop")) ?? "";
    // The status is embedded in the editor's top border, not drawn as an extra row.
    assert.match(statusRow.trim(), /^╭─ \S.*to stop.* ─+╮$/);
    await new Promise((done) => setTimeout(done, 1500));
    await pi.shot("status-tools");
    const screen = pi.screen().join("\n");
    assert.ok(screen.includes("bash sleep 3"), screen);
    assert.ok(screen.includes("to stop"), screen);
  } finally {
    await pi.close();
  }
});

test("working line shows Thinking while the model streams thinking", { timeout: 180_000 }, async () => {
  const pi = await startPi({
    scenario: {
      files: { "README.md": "# demo\n" },
      tokensPerSecond: 30,
      turns: [[{ thinking: "x".repeat(200) }, { text: "done" }]],
    },
  });
  try {
    pi.type("think\r");
    await pi.waitFor(/Thinking +.*to stop/);
    await pi.shot("status-thinking");
  } finally {
    await pi.close();
  }
});

test("working line shows Responding without the token rate", { timeout: 180_000 }, async () => {
  const pi = await startPi({
    scenario: {
      files: { "README.md": "# demo\n" },
      tokensPerSecond: 30,
      turns: [[{ text: "word ".repeat(200) }]],
    },
  });
  try {
    pi.type("write\r");
    await pi.waitFor(/Responding +.*to stop/);
    await new Promise((done) => setTimeout(done, 1500));
    const statusRow = pi.screen().find((row) => row.includes("to stop")) ?? "";
    assert.equal(statusRow.includes("tok/s"), false, statusRow);
    await pi.shot("status-responding");
  } finally {
    await pi.close();
  }
});

test("Pi without pi-tune has no working line during a tool", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: toolScenario(), tune: false });
  try {
    pi.type("run it\r");
    await pi.waitFor("run it");
    await new Promise((done) => setTimeout(done, 1000));
    await pi.shot("status-before");
    assert.equal(/to stop/.test(pi.screen().join("\n")), false);
  } finally {
    await pi.close();
  }
});
