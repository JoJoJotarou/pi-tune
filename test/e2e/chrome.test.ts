import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type Scenario, startPi } from "./harness.ts";

// Keep the chrome acceptance run on a short cwd so the key hints fit at 100 columns.
process.env.TMPDIR = "/tmp";

function scenario(tokensPerSecond?: number): Scenario {
  return {
    files: { "README.md": "# demo\n" },
    turns: [[{ tool: "bash", args: { command: "sleep 2" } }], [{ text: "done ".repeat(40) }]],
    tokensPerSecond,
  };
}

test("idle chrome shows a one-row header and a native footer", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: scenario(), cols: 100, rows: 30 });
  try {
    await pi.waitFor("π pi 1.4.0");
    await pi.waitFor("/ commands");
    await pi.waitFor("ctrl+s stash");
    const screen = pi.screen();
    const headerRows = screen.filter((line) => line.includes("π pi"));
    assert.equal(headerRows.length, 1, screen.join("\n"));
    assert.ok(headerRows[0].includes("· project"), headerRows[0]);
    assert.equal(headerRows[0].includes("/hotkeys"), false, headerRows[0]);
    assert.equal(headerRows[0].includes("skills"), false, headerRows[0]);
    assert.equal(headerRows[0].includes("MCP"), false, headerRows[0]);

    const footerRows = screen.filter((line) => line.includes("%/"));
    assert.equal(footerRows.length, 1, screen.join("\n"));
    const footer = footerRows[0];
    assert.ok(footer, screen.join("\n"));
    assert.ok(footer.includes("project"), footer);
    assert.ok(footer.includes("%/"), footer);
    assert.ok(footer.includes("(auto)"), footer);
    assert.ok(!footer.includes("full/path"), footer);
    await pi.shot("footer-idle");
    await pi.shot("header");
  } finally {
    await pi.close();
  }
});

test("busy chrome shows steer and follow-up only while text is typed", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: scenario(30), cols: 100, rows: 30 });
  try {
    pi.type("run it\r");
    await pi.waitFor(/bash sleep 2.*to stop/, 60_000);
    const busy = pi.screen().find((line) => line.includes("project")) ?? "";
    assert.equal(busy.includes("enter steer"), false, busy);

    pi.type("steer me");
    await pi.waitFor("enter steer");
    await pi.waitFor("follow-up");
    const footer = pi.screen().find((line) => line.includes("enter steer"));
    assert.ok(footer, pi.screen().join("\n"));
    assert.ok(footer.includes("follow-up"), footer);
    assert.equal(pi.screen().join("\n").includes("queue"), false, pi.screen().join("\n"));
    await pi.shot("footer-busy-typing");
  } finally {
    await pi.close();
  }
});

test("footer shows the live token rate while a message streams", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: scenario(30), cols: 100, rows: 30 });
  try {
    pi.type("write\r");
    await pi.waitFor(/tok\/s/, 60_000);
    const footer = pi.screen().find((line) => line.includes("tok/s")) ?? "";
    assert.ok(footer.includes("%/"), footer);
    assert.ok(footer.includes("(auto)"), footer);
    const statusRow = pi.screen().find((row) => row.includes("to stop")) ?? "";
    assert.equal(statusRow.includes("tok/s"), false, statusRow);
    await pi.shot("footer-rate");
  } finally {
    await pi.close();
  }
});

test("narrow chrome keeps the footer inside 40 columns", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: scenario(), cols: 40, rows: 30 });
  try {
    await pi.waitFor("(auto)");
    const footerRows = pi.screen().filter((line) => line.includes("(auto)"));
    assert.equal(footerRows.length, 1, pi.screen().join("\n"));
    assert.ok(visibleWidth(footerRows[0]) <= 40, footerRows[0]);
    assert.ok(footerRows[0].includes("%/"), footerRows[0]);
    const headerRow = pi.screen().find((line) => line.includes("π pi")) ?? "";
    assert.ok(visibleWidth(headerRow) <= 40, headerRow);
    await pi.shot("footer-narrow-40");
  } finally {
    await pi.close();
  }
});

test("a short message after a measured one keeps the last token rate", { timeout: 180_000 }, async () => {
  const shortAfterLong: Scenario = {
    files: { "README.md": "# demo\n" },
    // The first message streams for over a second; the short one after the tool is too quick to measure.
    turns: [[{ text: "reading ".repeat(40) }, { tool: "bash", args: { command: "true" } }], [{ text: "all done" }]],
    tokensPerSecond: 30,
  };
  const pi = await startPi({ scenario: shortAfterLong, cols: 100, rows: 30 });
  try {
    pi.type("go\r");
    await pi.waitFor("all done", 60_000);
    await pi.waitForGone("to stop");
    const footer = pi.screen().find((line) => line.includes("%/")) ?? "";
    assert.ok(footer.includes("tok/s"), footer);
  } finally {
    await pi.close();
  }
});
