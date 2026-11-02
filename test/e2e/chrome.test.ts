import assert from "node:assert/strict";
import test from "node:test";
import { type Scenario, startPi } from "./harness.ts";

// Keep the chrome acceptance run on a short cwd so the key hints fit at 100 columns.
process.env.TMPDIR = "/tmp";

function scenario(): Scenario {
  return {
    files: { "README.md": "# demo\n" },
    turns: [[{ tool: "bash", args: { command: "sleep 2" } }], [{ text: "done" }]],
  };
}

test("idle chrome shows a one-row header with /hotkeys", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: scenario(), cols: 100, rows: 30 });
  try {
    await pi.waitFor("π pi");
    const headerRows = pi.screen().filter((line) => line.includes("π pi"));
    assert.equal(headerRows.length, 1, pi.screen().join("\n"));
    assert.ok(headerRows[0].includes("/hotkeys"), headerRows[0]);
    await pi.shot("chrome-idle");
  } finally {
    await pi.close();
  }
});

test("running chrome shows stop and queue hints", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: scenario(), cols: 100, rows: 30 });
  try {
    pi.type("run it\r");
    await pi.waitFor("enter steer");
    await pi.waitFor("queue");
    const screen = pi.screen().join("\n");
    assert.ok(screen.includes("stop"), screen);
    await pi.shot("chrome-running");
  } finally {
    await pi.close();
  }
});

test("narrow chrome keeps a one-row footer with ctx", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: scenario(), cols: 60, rows: 30 });
  try {
    await pi.waitFor(/ctx \d+%/);
    const footerRows = pi.screen().filter((line) => /ctx \d+%/.test(line));
    assert.equal(footerRows.length, 1, pi.screen().join("\n"));
    await pi.shot("chrome-narrow");
  } finally {
    await pi.close();
  }
});

test("Pi without pi-tune keeps its built-in chrome", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: scenario(), cols: 100, rows: 30, tune: false });
  try {
    assert.equal(pi.screen().join("\n").includes("π pi"), false, pi.screen().join("\n"));
    await pi.shot("chrome-before");
  } finally {
    await pi.close();
  }
});
