import assert from "node:assert/strict";
import test from "node:test";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

const cols = 100;
const rows = 30;
// The rail covers Pi's scrollbar column and the padding left of it.
const settings = { fullscreenScrollbar: "always" };
const questions = ["first question", "second question", "third question", "fourth question"];

function answer(number: number, lines = 20): string {
  return [
    `answer ${number}`,
    ...Array.from({ length: lines }, (_, i) => `${i + 1}. answer ${number} line ${i + 1}`),
  ].join("\n");
}

const scenario: Scenario = {
  files: { "README.md": "# demo\n" },
  turns: questions.map((_, i) => [{ text: answer(i + 1) }]),
};

async function runTurns(pi: PiSession): Promise<void> {
  for (let i = 0; i < questions.length; i++) {
    pi.type(`${questions[i]}\r`);
    await pi.waitFor(`answer ${i + 1} line 20`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function rowOf(pi: PiSession, text: string): number {
  return pi.screen().findIndex((line) => line.includes(text));
}

async function waitForRow(pi: PiSession, text: string, expectedRows: number[], timeoutMs = 20_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = rowOf(pi, text);
    if (expectedRows.includes(row)) return row;
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForRow timed out: ${text} not at row ${expectedRows.join(" or ")}\n${pi.screen().join("\n")}`,
      );
    }
    await sleep(50);
  }
}

/** Wait for `text` to leave the row it was on, which proves the transcript scrolled. */
async function waitForShift(pi: PiSession, text: string, from: number, timeoutMs = 10_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = rowOf(pi, text);
    if (row !== from) return row;
    if (Date.now() >= deadline) {
      throw new Error(`waitForShift timed out: ${text} still at row ${from}\n${pi.screen().join("\n")}`);
    }
    await sleep(50);
  }
}

interface RailMarks {
  ticks: number[];
  up: number | undefined;
  down: number | undefined;
}

/** The rail draws in the last column: chevrons `▴`/`▾` around ticks `─`/`━`. */
function railMarks(pi: PiSession, width = cols): RailMarks {
  const screen = pi.screen();
  const cell = (row: number) => (screen[row].length >= width ? screen[row][width - 1] : "");
  const marks: RailMarks = { ticks: [], up: undefined, down: undefined };
  screen.forEach((_, row) => {
    if (cell(row) === "▴") marks.up = row;
    else if (cell(row) === "▾") marks.down = row;
  });
  if (marks.up !== undefined && marks.down !== undefined) {
    for (let row = marks.up + 1; row < marks.down; row++) {
      if (cell(row) === "─" || cell(row) === "━") marks.ticks.push(row);
    }
  }
  return marks;
}

function assertNoRail(pi: PiSession, width = cols): void {
  const screen = pi.screen().join("\n");
  assert.ok(!screen.includes("▴") && !screen.includes("▾"), `rail chevrons at ${width} columns\n${screen}`);
  assert.ok(!pi.screen().some((line) => line[width - 1] === "━"), `rail tick at ${width} columns\n${screen}`);
  assert.deepEqual(railMarks(pi, width).ticks, [], `rail ticks at ${width} columns\n${screen}`);
}

/** Page up to the transcript top; no prompt is above the viewport there, so no overlay covers the scrollbar. */
async function scrollToTop(pi: PiSession): Promise<void> {
  for (let i = 0; i < 12; i++) {
    pi.press("pageup");
    await sleep(100);
  }
  await sleep(400);
  assert.notEqual(pi.screen()[0].trim(), "", `not at the transcript top\n${pi.screen().join("\n")}`);
}

test("the rail ticks jump between prompts", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols, rows, tune: true, settings });
  try {
    await runTurns(pi);

    const marks = railMarks(pi);
    assert.equal(marks.ticks.length, questions.length, `expected one tick per prompt\n${pi.screen().join("\n")}`);
    assert.ok(marks.up !== undefined && marks.down !== undefined, "missing chevrons");
    assert.ok(
      marks.up < marks.ticks[0] && marks.ticks[marks.ticks.length - 1] < marks.down,
      "ticks not between chevrons",
    );
    // The active tick fills both rail columns; the others use the right one only.
    assert.ok(
      marks.ticks.some((row) => pi.screen()[row][cols - 1] === "━"),
      `no active tick\n${pi.screen().join("\n")}`,
    );
    await pi.shot("timeline-rail");

    pi.click(cols - 1, marks.ticks[0]);
    await waitForRow(pi, "first question", [0, 1]);

    // The chevrons jump to the nearest prompt above and below the viewport top.
    pi.click(cols - 1, marks.down);
    await waitForRow(pi, "second question", [0, 1]);
    pi.click(cols - 1, marks.up);
    await waitForRow(pi, "first question", [0, 1]);

    // A hovered tick previews its prompt left of the rail; leaving the tick hides the card.
    pi.move(cols - 1, marks.ticks[2]);
    await pi.waitFor("third question");
    await pi.shot("timeline-hover");
    pi.move(cols - 1, 0);
    await pi.waitForGone("third question");

    // The card sits directly left of the rail, so a sideways step onto it hides it at once.
    pi.move(cols - 1, marks.ticks[2]);
    await pi.waitFor("third question");
    pi.move(cols - 3, marks.ticks[2]);
    await pi.waitForGone("third question", 1000);

    // A single step past the card leaves no overlay to tell; the idle timer hides it.
    pi.move(cols - 1, marks.ticks[2]);
    await pi.waitFor("third question");
    pi.move(10, marks.ticks[2]);
    await pi.waitForGone("third question", 2500);

    // A wheel over the rail scrolls the transcript natively.
    const before = rowOf(pi, "15. answer 1 line 15");
    assert.ok(before > 0, `answer line not visible\n${pi.screen().join("\n")}`);
    pi.wheel(cols - 1, marks.ticks[0]);
    assert.ok((await waitForShift(pi, "15. answer 1 line 15", before)) < before, "wheel did not scroll");
  } finally {
    await pi.close();
  }
});

test("many prompts stack one tick each", { timeout: 180_000 }, async () => {
  const many: Scenario = {
    files: { "README.md": "# demo\n" },
    turns: Array.from({ length: 8 }, (_, i) => [{ text: `answer ${i + 1}\nsecond line` }]),
  };
  const pi = await startPi({ scenario: many, cols, rows, tune: true, settings });
  try {
    for (let i = 1; i <= 8; i++) {
      pi.type(`question ${i}\r`);
      await pi.waitFor(`answer ${i}`);
    }
    await sleep(500);

    const marks = railMarks(pi);
    assert.equal(marks.ticks.length, 8, `expected 8 ticks\n${pi.screen().join("\n")}`);
    await pi.shot("timeline-many-prompts");
  } finally {
    await pi.close();
  }
});

test("a narrow terminal hides the rail and keeps Pi's scrollbar usable", { timeout: 180_000 }, async () => {
  const narrow = 50;
  const pi = await startPi({ scenario, cols: narrow, rows, tune: true, settings });
  try {
    await runTurns(pi);
    assertNoRail(pi, narrow);

    // Back at the top no prompt is above the viewport, so no overlay covers the scrollbar.
    await scrollToTop(pi);
    await pi.shot("timeline-narrow");
    const before = rowOf(pi, "first question");
    pi.click(narrow - 1, 20);
    await waitForShift(pi, "first question", before);
  } finally {
    await pi.close();
  }
});

test("a single prompt leaves Pi's scrollbar alone", { timeout: 180_000 }, async () => {
  const single: Scenario = {
    files: { "README.md": "# demo\n" },
    turns: [[{ text: answer(1, 40) }]],
  };
  const pi = await startPi({ scenario: single, cols, rows, tune: true, settings });
  try {
    pi.type("only question\r");
    await pi.waitFor("answer 1 line 40");
    assertNoRail(pi);

    await scrollToTop(pi);
    const before = rowOf(pi, "only question");
    pi.click(cols - 1, 20);
    await waitForShift(pi, "only question", before);
  } finally {
    await pi.close();
  }
});

test("selecting text blanks the rail so a copy leaves it and the scrollbar out", { timeout: 180_000 }, async () => {
  // Pi copies the selection as drawn on screen; copy-on-select off keeps the test off the system clipboard.
  const pi = await startPi({
    scenario,
    cols,
    rows,
    tune: true,
    settings: { ...settings, fullscreenCopyOnSelect: false },
  });
  try {
    await runTurns(pi);
    await pi.waitFor("▴");

    pi.drag(1, 4, 59, 19);
    await pi.waitForGone("▴");
    assertNoRail(pi);
    const transcript = pi.screen().slice(0, 20);
    assert.ok(!transcript.some((line) => /[│┃]$/.test(line)), `Pi's scrollbar is uncovered\n${transcript.join("\n")}`);

    pi.click(20, 22);
    await pi.waitFor("▴");
  } finally {
    await pi.close();
  }
});

test("/timeline lists the prompts and jumps to one", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols, rows, tune: true, settings });
  try {
    await runTurns(pi);

    pi.type("/timeline\r");
    await pi.waitFor("Prompts in this session");
    await new Promise((done) => setTimeout(done, 200));
    await pi.shot("timeline-list");
    pi.press("down");
    pi.press("down");
    pi.press("enter");

    await waitForRow(pi, "third question", [0, 1]);
  } finally {
    await pi.close();
  }
});

test("timeline reports that it needs fullscreen mode outside fullscreen", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols, rows, tune: true, settings: { ...settings, tuiMode: "regular" } });
  try {
    pi.type(`${questions[0]}\r`);
    await pi.waitFor("answer 1 line 20");

    pi.type("/timeline\r");
    await pi.waitFor("Timeline needs fullscreen mode");
    await pi.shot("timeline-regular");

    pi.type(`${questions[1]}\r`);
    await pi.waitFor("answer 2 line 20");
  } finally {
    await pi.close();
  }
});

test("the rail stays centered on the transcript while the editor grows", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario, cols, rows, tune: true, settings });
  try {
    await runTurns(pi);
    pi.type("draft");
    await pi.waitFor("draft");
    await sleep(300);
    const before = railMarks(pi);
    const draftRow = rowOf(pi, "draft");
    assert.ok(before.up !== undefined, `no rail\n${pi.screen().join("\n")}`);

    for (let line = 1; line <= 6; line++) {
      pi.press("ctrl+j");
      pi.type(`more ${line}`);
    }
    await pi.waitFor("more 6");
    await sleep(300);
    const grown = draftRow - rowOf(pi, "draft");
    const after = railMarks(pi);
    assert.ok(grown > 0, `the editor did not grow\n${pi.screen().join("\n")}`);
    // The ticks are centered on the transcript rows, so they rise by half of what the editor took.
    const shift = (before.up ?? 0) - (after.up ?? 0);
    assert.ok(
      shift === Math.floor(grown / 2) || shift === Math.ceil(grown / 2),
      `editor grew ${grown} rows, rail rose ${shift}\n${pi.screen().join("\n")}`,
    );
    assert.equal(after.ticks.length, questions.length, pi.screen().join("\n"));
  } finally {
    await pi.close();
  }
});
