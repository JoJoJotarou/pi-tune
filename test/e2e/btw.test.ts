import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { detectSandbox } from "../../src/btw/sandbox.ts";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

const DRAWER = /╭─ btw #\d/;
/** The editor's top border while btw mode is on. */
const BTW_EDITOR = /╭─ btw ─/;

function rowOf(pi: PiSession, pattern: RegExp): number {
  const row = pi.screen().findIndex((line) => pattern.test(line));
  assert.ok(row >= 0, `no row matches ${pattern}\n${pi.screen().join("\n")}`);
  return row;
}

test("btw mode: ask, follow up, close with esc, reopen a thread from the list", { timeout: 180_000 }, async () => {
  const scenario: Scenario = {
    files: { "README.md": "# demo\n" },
    turns: [
      [{ text: "main answer one" }],
      [{ text: "side answer one" }],
      [{ text: "side answer two" }],
      [{ text: "main answer two" }],
      [{ text: "side answer three" }],
    ],
  };
  const pi = await startPi({ scenario });
  try {
    pi.type("first main question\r");
    await pi.waitFor("main answer one");

    pi.type("/btw what does the read tool do?\r");
    await pi.waitFor("side answer one");
    await pi.waitFor(BTW_EDITOR);
    let screen = pi.screen().join("\n");
    assert.match(screen, /╭─ btw #1 ─+ @turn 1 · main 1 ─╮/, "title and anchor on the drawer's top border");
    assert.ok(screen.includes("what does the read tool do?"), screen);
    assert.ok(screen.includes("enter ask"), screen);
    await pi.shot("btw-drawer");

    // Enter in btw mode continues the side thread, not the main session.
    pi.type("and the bash tool?\r");
    await pi.waitFor("side answer two");
    screen = pi.screen().join("\n");
    const asked = pi.screen().filter((line) => line.includes("and the bash tool?"));
    assert.ok(asked.length === 1 && asked[0].startsWith("│"), "only the drawer shows it");

    // Esc belongs to whatever has focus: it closes the thread list first and leaves the drawer open.
    pi.type("/btw\r");
    await pi.waitFor("New thread");
    pi.press("escape");
    await pi.waitForGone("New thread");
    assert.match(pi.screen().join("\n"), DRAWER);

    // Esc on the empty editor closes the drawer; Enter goes to the main session again.
    pi.press("escape");
    await pi.waitForGone(DRAWER);
    await pi.waitForGone(BTW_EDITOR);
    pi.type("second main question\r");
    await pi.waitFor("main answer two");

    // `/btw` alone lists the threads; the one picked opens with its history and the turns it cannot see.
    pi.type("/btw\r");
    await pi.waitFor("New thread");
    await pi.waitFor("#1 what does the read tool do?");
    await pi.shot("btw-threads");
    pi.press("enter");
    await pi.waitFor(DRAWER);
    screen = pi.screen().join("\n");
    assert.ok(screen.includes("@turn 1 · main 2 (+1)"), screen);
    assert.ok(screen.includes("side answer two"), "the thread's history is back");
    await pi.shot("btw-drawer-stale");

    pi.type("one more\r");
    await pi.waitFor("side answer three");
  } finally {
    await pi.close();
  }
});

test("a running side question shows at once, streams, and esc stops it", { timeout: 180_000 }, async () => {
  const scenario: Scenario = {
    turns: [[{ thinking: "hmm ".repeat(30) }, { text: `${"slow ".repeat(200)}END` }]],
    tokensPerSecond: 20,
  };
  const pi = await startPi({ scenario });
  try {
    pi.type("/btw why is it slow?\r");
    await pi.waitFor("why is it slow?");
    await pi.waitFor(/esc stop/);
    await pi.waitFor(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Thinking · \d+\.\ds/);
    await pi.waitFor(/│ {2}slow slow/);
    await pi.waitFor(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Responding · \d+\.\ds/);
    await pi.shot("btw-running");

    // Enter while the answer runs keeps the draft for later.
    pi.type("next question\r");
    await pi.waitFor("A side question is still answering");
    await pi.waitFor(/│ ?next question/);
    for (let i = 0; i < "next question".length; i++) pi.press("backspace");
    await pi.waitForGone(/│ ?next question/);

    pi.press("escape");
    await pi.waitForGone(/esc stop/);
    await pi.waitFor(/enter ask/);
    const editor = pi.screen().slice(rowOf(pi, BTW_EDITOR)).join("\n");
    assert.ok(editor.includes("why is it slow?"), `the stopped question is back in the editor:\n${editor}`);
    assert.ok(!pi.screen().join("\n").includes("END"));
  } finally {
    await pi.close();
  }
});

test("a long answer scrolls with the wheel and shift+arrows", { timeout: 180_000 }, async () => {
  const lines = Array.from({ length: 40 }, (_, index) => `- line ${index + 1}`).join("\n");
  const pi = await startPi({ scenario: { turns: [[{ text: lines }]] } });
  try {
    pi.type("/btw list forty lines\r");
    await pi.waitFor("line 40");
    await pi.waitFor(/↑ \d+ ·/);
    assert.ok(!pi.screen().join("\n").includes("list forty lines"), "the start is scrolled off");

    const body = rowOf(pi, DRAWER) + 2;
    for (let i = 0; i < 40; i++) pi.wheel(10, body, "up");
    await pi.waitFor("list forty lines");
    await pi.waitFor(/↓ \d+ ·/);
    await pi.shot("btw-scrolled");

    pi.type("\x1b[1;2B".repeat(10));
    await pi.waitFor("line 40");
    await pi.waitForGone(/↓ \d+ ·/);
    pi.type("\x1b[1;2A");
    await pi.waitFor(/↓ \d+ ·/);
  } finally {
    await pi.close();
  }
});

test("the drawer fits a 40x20 terminal", { timeout: 180_000 }, async () => {
  const pi = await startPi({
    scenario: { turns: [[{ text: "a fairly long side answer that has to wrap inside a narrow drawer" }]] },
    cols: 40,
    rows: 20,
  });
  try {
    pi.type("/btw a narrow question that wraps\r");
    await pi.waitFor(/narrow +│|drawer +│/);
    for (const line of pi.screen()) assert.ok(line.length <= 40, line);
    await pi.shot("btw-narrow");
  } finally {
    await pi.close();
  }
});

test("side threads run allowed tools, refuse the rest and show only the exchange", { timeout: 180_000 }, async () => {
  const scenario: Scenario = {
    files: { "README.md": "# demo\n" },
    turns: [
      [{ tool: "read", args: { path: "README.md" } }],
      [{ tool: "bash", args: { command: "git log --oneline -5" } }],
      [{ text: "side answer after tools" }],
    ],
  };
  const pi = await startPi({ scenario });
  try {
    pi.type("/btw what is in the readme?\r");
    await pi.waitFor("side answer after tools");
    await pi.waitFor("⚠ blocked: bash(git log *)");
    const screen = pi.screen().join("\n");
    assert.ok(!/^\s*\$ git log/m.test(screen) && !screen.includes("# demo"), "no tool blocks are drawn");
    await pi.shot("btw-denied");
  } finally {
    await pi.close();
  }
});

test("an allowed bash command runs read-only", { timeout: 180_000 }, async () => {
  const sandbox = detectSandbox();
  // Outside the temp directories, which the sandbox leaves writable and where the scenario's project lives.
  const target = join(import.meta.dirname, `made-by-btw-${process.pid}.txt`);
  const scenario: Scenario = {
    turns: [[{ tool: "bash", args: { command: `touch ${target}` } }], [{ text: "tried to touch" }]],
  };
  const pi = await startPi({
    scenario,
    agentFiles: { "pi-tune.json": JSON.stringify({ btw: { allow: ["read", "bash(touch *)"] } }) },
  });
  try {
    pi.type("/btw make a file\r");
    await pi.waitFor("tried to touch");
    assert.ok(!pi.screen().join("\n").includes("blocked"), "the rule allowed it");
    if (sandbox instanceof Error) {
      await pi.waitFor("btw runs allowed bash commands without a sandbox");
      assert.ok(existsSync(target));
    } else {
      assert.ok(!existsSync(target), "the sandbox blocked the write");
    }
  } finally {
    await pi.close();
    rmSync(target, { force: true });
  }
});

test("a broken btw setting warns with the file and field, and keeps the defaults", { timeout: 180_000 }, async () => {
  const pi = await startPi({
    scenario: { turns: [] },
    agentFiles: { "pi-tune.json": JSON.stringify({ btw: { allow: "read" } }) },
  });
  try {
    await pi.waitFor("btw tools use the defaults:");
    const warning = pi.screen().join(" ").replace(/\s+/g, " ");
    assert.match(warning, /pi-tune\.json has a "btw\.allow" value that is not a list of strings/);
  } finally {
    await pi.close();
  }
});

function sessionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sessionFiles(path);
    return entry.name.endsWith(".jsonl") ? [path] : [];
  });
}

test("threads come back after /reload, saved one turn per entry", { timeout: 180_000 }, async () => {
  const pi = await startPi({
    scenario: {
      turns: [[{ text: "main answer" }], [{ text: "first side answer" }], [{ text: "second side answer" }]],
    },
    session: true,
  });
  try {
    // Pi writes the session file once the main session has an answer.
    pi.type("main question\r");
    await pi.waitFor("main answer");
    pi.type("/btw first question\r");
    await pi.waitFor("first side answer");
    pi.type("second question\r");
    await pi.waitFor("second side answer");
    pi.press("escape");
    await pi.waitForGone(DRAWER);

    const files = sessionFiles(join(pi.projectDir, "..", "agent"));
    const saved = files
      .flatMap((file) => readFileSync(file, "utf8").split("\n").filter(Boolean))
      .map((line) => JSON.parse(line) as { type?: string; customType?: string; data?: Record<string, unknown> })
      .filter((entry) => entry.customType === "pi-tune-btw");
    assert.equal(saved.length, 2, "one entry per answered turn");
    for (const entry of saved) assert.deepEqual(Object.keys(entry.data ?? {}).sort(), ["thread", "turn"]);
    const texts = saved.map((entry) => String((entry.data?.turn as { text?: unknown } | undefined)?.text));
    assert.match(
      texts[0],
      /Only these tool calls run in this thread: read, grep, find, ls\./,
      "told on the first question",
    );
    assert.doesNotMatch(texts[1], /btw_tools/, "not repeated while the rules stay the same");

    pi.type("/reload\r");
    // Keys typed before the reload finishes are lost.
    await pi.waitFor("Reloaded keybindings");
    pi.type("/btw\r");
    await pi.waitFor("#1 first question");
    await pi.waitFor("2 turns");
    pi.press("enter");
    await pi.waitFor(DRAWER);
    const screen = pi.screen().join("\n");
    assert.ok(screen.includes("first side answer") && screen.includes("second side answer"), screen);
  } finally {
    await pi.close();
  }
});

test("a rule added to pi-tune.json applies to the next question without /reload", { timeout: 180_000 }, async () => {
  const scenario: Scenario = {
    turns: [
      [{ tool: "bash", args: { command: "date +%F" } }],
      [{ text: "first try" }],
      [{ tool: "bash", args: { command: "date +%F" } }],
      [{ text: "second try" }],
    ],
  };
  const pi = await startPi({ scenario });
  try {
    pi.type("/btw what day is it?\r");
    await pi.waitFor("first try");
    await pi.waitFor("⚠ blocked: bash(date *)");

    const config = join(pi.projectDir, "..", "agent", "pi-tune.json");
    writeFileSync(config, JSON.stringify({ btw: { allow: ["read", "bash(date *)"] } }));
    pi.type("and now?\r");
    await pi.waitFor("second try");
    const blocked = pi.screen().filter((row) => row.includes("⚠ blocked"));
    assert.equal(blocked.length, 1, "only the first answer was refused");
  } finally {
    await pi.close();
  }
});
