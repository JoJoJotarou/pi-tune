import assert from "node:assert/strict";
import test from "node:test";
import { type Scenario, startPi } from "./harness.ts";

function toolScenario(): Scenario {
  return {
    files: { "README.md": "# demo\n" },
    turns: [[{ tool: "bash", args: { command: "sleep 1" } }], [{ text: "finished" }]],
  };
}

test("working line stays Working while a tool runs, without naming it", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: toolScenario() });
  try {
    pi.type("run it\r");
    await pi.waitFor(/to stop/);
    const statusRow = pi.screen().find((row) => row.includes("to stop")) ?? "";
    // The status is embedded in the editor's top border, not drawn as an extra row.
    assert.match(statusRow.trim(), /^╭─ \S.*to stop.* ─+╮$/);
    assert.match(statusRow, /Working .*to stop/, statusRow);
    assert.equal(statusRow.includes("bash"), false, statusRow);
    await pi.shot("status-tools");
  } finally {
    await pi.close();
  }
});

test("a finished run leaves an indented Worked for line", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: { files: {}, turns: [[{ text: "all done." }]] } });
  try {
    pi.type("go\r");
    await pi.waitFor("all done.");
    await pi.waitFor(/Worked for \d/);
    const row = pi.screen().find((line) => line.includes("Worked for")) ?? "";
    assert.match(row, /^ Worked for \d/, row);
    await pi.shot("worked-for");
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
      turns: [[{ text: "word ".repeat(80) }]],
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
