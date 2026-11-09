import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { type Scenario, startPi } from "./harness.ts";

// Keep the chrome acceptance run on a short cwd so the key hints fit at 100 columns.
process.env.TMPDIR = "/tmp";

function scenario(tokensPerSecond?: number): Scenario {
  return {
    files: { "README.md": "# demo\n" },
    turns: [[{ tool: "bash", args: { command: "sleep 1" } }], [{ text: "done ".repeat(40) }]],
    tokensPerSecond,
  };
}

test("idle chrome shows a one-row header and a two-row footer", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: scenario(), cols: 100, rows: 30 });
  try {
    await pi.waitFor("π pi 1.4.0");
    await pi.waitFor("/ commands");
    assert.equal(pi.screen().join("\n").includes("ctrl+s"), false, "nothing to stash and no stash held");
    const screen = pi.screen();
    const headerRows = screen.filter((line) => line.includes("π pi"));
    assert.equal(headerRows.length, 1, screen.join("\n"));
    assert.ok(headerRows[0].includes("· project"), headerRows[0]);
    assert.equal(headerRows[0].includes("/hotkeys"), false, headerRows[0]);
    assert.equal(headerRows[0].includes("skills"), false, headerRows[0]);
    assert.equal(headerRows[0].includes("MCP"), false, headerRows[0]);

    const footerRows = screen.filter((line) => line.includes("◔"));
    assert.equal(footerRows.length, 1, screen.join("\n"));
    const footer = footerRows[0];
    assert.ok(footer, screen.join("\n"));
    assert.ok(footer.includes("%"), footer);
    assert.ok(!footer.includes("full/path"), footer);
    const identity = screen.find((line) => line.includes("project")) ?? "";
    assert.ok(identity.includes("project"), screen.join("\n"));
    await pi.shot("footer-idle");
    await pi.shot("header");
  } finally {
    await pi.close();
  }
});

test("key hints follow the draft, the stash and the focused dialog", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: scenario(), cols: 100, rows: 30 });
  try {
    await pi.waitFor("@ files");

    // A draft turns off the prefixes that need the start of the message.
    pi.type("a draft");
    await pi.waitFor("ctrl+s stash");
    const drafted = pi.screen().find((line) => line.includes("ctrl+s stash")) ?? "";
    assert.equal(drafted.includes("/ commands"), false, drafted);
    assert.equal(drafted.includes("! shell"), false, drafted);
    assert.ok(drafted.includes("@ files"), drafted);
    await pi.shot("footer-hints-draft");

    // ctrl+s takes the draft; with an empty editor and a stash held the hint names the restore.
    pi.press("ctrl+s");
    await pi.waitFor("ctrl+s restore");
    await pi.waitForGone("a draft");

    pi.press("ctrl+s");
    await pi.waitFor("a draft");
    await pi.waitForGone("ctrl+s restore");

    // A dialog takes the keyboard, so the hints step aside and come back when it closes.
    pi.press("ctrl+u");
    await pi.waitForGone("a draft");
    pi.press("ctrl+l");
    await pi.waitFor("Only showing models from configured providers.");
    const during = pi.screen().find((row) => row.includes("◔")) ?? "";
    assert.ok(during, pi.screen().join("\n"));
    assert.equal(during.includes("@ files"), false, during);
    await pi.shot("footer-hints-dialog");
    pi.press("escape");
    await pi.waitFor("@ files");
  } finally {
    await pi.close();
  }
});

test("busy chrome shows steer and follow-up only while text is typed", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: scenario(30), cols: 100, rows: 30 });
  try {
    pi.type("run it\r");
    await pi.waitFor(/to stop/, 60_000);
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
    assert.ok(footer.includes("%"), footer);
    const statusRow = pi.screen().find((row) => row.includes("to stop")) ?? "";
    assert.equal(statusRow.includes("tok/s"), false, statusRow);
    assert.match(footer, /TTFT \d/, footer);
    await pi.shot("footer-rate");
  } finally {
    await pi.close();
  }
});

test("narrow chrome keeps the footer inside 40 columns", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: scenario(), cols: 40, rows: 30 });
  try {
    await pi.waitFor("◔");
    const footerRows = pi.screen().filter((line) => line.includes("◔"));
    assert.equal(footerRows.length, 1, pi.screen().join("\n"));
    assert.ok(visibleWidth(footerRows[0]) <= 40, footerRows[0]);
    assert.ok(footerRows[0].includes("%"), footerRows[0]);
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
    const footer = pi.screen().find((line) => line.includes("tok/s")) ?? "";
    assert.ok(footer.includes("%"), footer);
  } finally {
    await pi.close();
  }
});

test("the timeline rail keeps the header counts intact", { timeout: 180_000 }, async () => {
  const twoTurns: Scenario = {
    files: { "README.md": "# demo\n" },
    turns: [[{ text: "ready" }], [{ text: "done" }]],
  };
  const pi = await startPi({
    scenario: twoTurns,
    cols: 100,
    rows: 30,
    settings: { quietStartup: "header", fullscreenScrollbar: "always" },
    skills: true,
    agentFiles: {
      "skills/review/SKILL.md": "---\nname: review\ndescription: Review a diff.\n---\n\n# review\n",
    },
  });
  try {
    pi.type("first\r");
    await pi.waitFor("ready");
    pi.type("second\r");
    await pi.waitFor("done");
    // Two prompts put the rail on screen; the header counts must keep their last column.
    await pi.waitFor(/π pi .*skill/);
    const screen = pi.screen();
    const lastColumn = screen.map((line) => line.at(-1));
    assert.ok(lastColumn.includes("▴") && lastColumn.includes("▾"), screen.join("\n"));
    const header = screen.find((line) => line.includes("π pi")) ?? "";
    // CI loads a single skill, so the header reads "1 skill"; a clipped plural loses its last "s".
    const counts = header.trimEnd().match(/(\d+) (skill|skills)$/);
    assert.ok(counts, header);
    assert.equal(counts[2], counts[1] === "1" ? "skill" : "skills", header);
  } finally {
    await pi.close();
  }
});
