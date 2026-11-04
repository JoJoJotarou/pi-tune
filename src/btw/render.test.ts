import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { activityLabel, type DrawerInput, drawerMaxHeight, renderBtw } from "./render.ts";
import type { BtwThread, BtwTurn } from "./thread.ts";

initTheme("dark");
const theme = testTheme();
const markdown = getMarkdownTheme();

function assistant(
  text: string,
  usage = { input: 200, output: 120, cacheRead: 7800, cacheWrite: 0, totalTokens: 8120 },
  cost = 0,
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "probe",
    model: "probe-model",
    api: "openai-completions",
    usage: { ...usage, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: cost } },
    stopReason: "stop",
    timestamp: 1,
  } as AssistantMessage;
}

function turn(index: number, overrides: Partial<BtwTurn> = {}): BtwTurn {
  return {
    text: `question ${index}`,
    question: `question ${index}`,
    messages: [assistant(`answer ${index}`)],
    askedAt: index,
    durationMs: 3200,
    denied: [],
    ...overrides,
  };
}

function thread(turns: number, anchorTurns = 3): BtwThread {
  return {
    id: "btw-1",
    anchorEntryId: "e3",
    anchorTurns,
    turns: Array.from({ length: turns }, (_, index) => turn(index + 1)),
  };
}

function draw(overrides: Partial<DrawerInput> = {}) {
  return renderBtw({
    thread: thread(1),
    number: 1,
    mainTurns: 3,
    maxHeight: 16,
    width: 80,
    theme,
    markdown,
    ...overrides,
  });
}

function plain(lines: string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line));
}

/** The rows between the borders, without the side borders and the padding. */
function body(lines: string[]): string[] {
  const rows = plain(lines);
  const bottom = rows.findIndex((row, index) => index > 0 && row.startsWith("╰"));
  return rows.slice(1, bottom).map((row) => row.slice(1, -1).trim());
}

describe("drawerMaxHeight", () => {
  it("takes at most half the screen and 16 rows", () => {
    assert.equal(drawerMaxHeight(60), 16);
    assert.equal(drawerMaxHeight(24), 12);
    assert.equal(drawerMaxHeight(20), 10);
    assert.equal(drawerMaxHeight(8), 6);
  });
});

describe("renderBtw", () => {
  it("never draws a line wider than the width it was given, and never more rows than allowed", () => {
    const long = "word ".repeat(300);
    const denied = Array.from({ length: 12 }, (_, index) => `bash(tool-${index} *)`);
    for (const width of [100, 40, 30]) {
      for (const maxHeight of [6, 10, 16]) {
        for (const turns of [0, 1, 3, 40]) {
          for (const pending of [undefined, { question: long, answer: long, elapsedMs: 1200, spinner: "⠋" }]) {
            const shown = thread(turns);
            if (turns > 0) shown.turns[0].denied = denied;
            const { lines } = draw({ thread: shown, width, maxHeight, pending });
            assert.ok(lines.length <= maxHeight, `${width}x${maxHeight}: ${lines.length} rows`);
            for (const line of lines)
              assert.ok(visibleWidth(line) <= width, `too wide at ${width}: ${stripTerminalSequences(line)}`);
          }
        }
      }
    }
  });

  it("draws the question as a user message block and the answer as plain text, with room around them", () => {
    const { lines } = draw();
    assert.deepEqual(body(lines), ["", "question 1", "", "answer 1", ""]);
    const question = lines.find((line) => stripTerminalSequences(line).includes("question 1")) ?? "";
    assert.ok(question.includes(theme.getBgAnsi("userMessageBg")), "the question has the user message background");
    assert.equal(lines.at(-1), "", "an empty row keeps the drawer off the editor");
    assert.ok(!plain(lines).some((row) => /\b(you|btw) (question|answer)/.test(row)), "no you/btw labels");
  });

  it("puts an empty row between turns", () => {
    assert.deepEqual(body(draw({ thread: thread(2) }).lines), [
      "",
      "question 1",
      "",
      "answer 1",
      "",
      "question 2",
      "",
      "answer 2",
      "",
    ]);
  });

  it("drops the padding rows when the drawer is short, to keep three rows of content", () => {
    const short = draw({ thread: thread(12), maxHeight: 7 });
    assert.equal(short.lines.length, 7);
    assert.equal(short.pageRows, 4);
    assert.equal(draw({ thread: thread(12), maxHeight: 16 }).pageRows, 11);
  });

  it("follows the newest row, and shows older rows from an explicit top", () => {
    const newest = draw({ thread: thread(12), maxHeight: 10 });
    const text = plain(newest.lines).join("\n");
    assert.ok(text.includes("answer 12"), "newest answer is visible");
    assert.ok(!text.includes("question 1 "), "oldest question is cut");
    assert.equal(newest.top, newest.maxTop);

    const oldest = plain(draw({ thread: thread(12), maxHeight: 10, top: 0 }).lines).join("\n");
    assert.ok(oldest.includes("question 1"), "top 0 starts at the first question");
    assert.ok(!oldest.includes("answer 12"));
    assert.equal(draw({ thread: thread(12), maxHeight: 10, top: 999 }).top, newest.maxTop, "top is clamped");
  });

  it("shows the latest turn's time, cache hit and cost on the bottom border, after the scroll position", () => {
    const priced = thread(2);
    priced.turns[1] = turn(2, { durationMs: 4200, messages: [assistant("answer 2", undefined, 0.0042)] });
    const bottom = plain(draw({ thread: priced, maxHeight: 8, width: 100 }).lines).at(-2) ?? "";
    assert.match(bottom, /↑ \d+ · 4\.2s · 98% cached · \$0\.004 ─╯$/);
    const free = plain(draw({ width: 100 }).lines).at(-2) ?? "";
    assert.match(free, /3\.2s · 98% cached ─╯$/, "no cost when the model has no price");
    const running = plain(draw({ pending: { question: "q", answer: "", elapsedMs: 0, spinner: "⠋" } }).lines).at(-2);
    assert.doesNotMatch(running ?? "", /cached/, "no usage while an answer runs");
  });

  it("keeps the key hints over the usage when the width is tight", () => {
    const narrow = plain(draw({ width: 40 }).lines).at(-2) ?? "";
    assert.ok(narrow.includes("enter ask") && narrow.includes("esc close"), narrow);
    assert.ok(!narrow.includes("…"), `hints are dropped whole: ${narrow}`);
  });

  it("puts the anchor on the top border and marks main turns the thread cannot see", () => {
    const behind = plain(draw({ thread: thread(1, 3), mainTurns: 8 }).lines)[0];
    assert.ok(behind.includes("btw #1"), behind);
    assert.ok(behind.includes("@turn 3 · main 8 (+5)"), behind);
    const inSync = plain(draw({ thread: thread(1, 3), mainTurns: 3 }).lines)[0];
    assert.ok(inSync.includes("@turn 3 · main 3") && !inSync.includes("(+"), inSync);
  });

  it("names the keys that work right now", () => {
    const idle = plain(draw().lines).at(-2) ?? "";
    assert.ok(idle.includes("enter ask") && idle.includes("esc close"), idle);
    assert.ok(!idle.includes("scroll"), "no scroll hint while everything fits");
    const long = plain(draw({ thread: thread(12), maxHeight: 8, width: 140 }).lines).at(-2) ?? "";
    assert.ok(long.includes("shift+↑↓ scroll"), long);
    const running =
      plain(draw({ pending: { question: "q", answer: "", elapsedMs: 0, spinner: "⠋" } }).lines).at(-2) ?? "";
    assert.ok(running.includes("esc stop") && !running.includes("enter ask"), running);
  });

  it("shows a running question at once, then the answer as it streams, then the tool that runs", () => {
    const waiting = body(draw({ pending: { question: "why?", answer: "", elapsedMs: 1200, spinner: "⠙" } }).lines);
    assert.ok(waiting.includes("why?") && waiting.includes("⠙ answering · 1.2s"), waiting.join("\n"));
    const streaming = body(
      draw({ pending: { question: "why?", answer: "because it", elapsedMs: 2500, spinner: "⠹" } }).lines,
    );
    assert.ok(streaming.includes("because it") && streaming.includes("⠹ 2.5s"), streaming.join("\n"));
    const tool = body(
      draw({ pending: { question: "q", answer: "", elapsedMs: 1500, spinner: "⠋", activity: "read src/x.ts" } }).lines,
    );
    assert.ok(tool.includes("⠋ read src/x.ts · 1.5s"), tool.join("\n"));
  });

  it("explains a new thread before its first question", () => {
    const fresh = plain(draw({ thread: null, number: 2, mainTurns: 4 }).lines);
    assert.ok(fresh[0].includes("btw #2"), fresh[0]);
    assert.ok(fresh.join("\n").includes("Ask a side question"), fresh.join("\n"));
  });

  it("renders the answer as Markdown", () => {
    const rich = thread(0);
    rich.turns = [turn(1, { messages: [assistant("use **bold** and `code`")] })];
    const rows = plain(draw({ thread: rich }).lines).join("\n");
    assert.ok(rows.includes("use bold and code") && !rows.includes("**"), rows);
  });

  it("lists refused calls under their answer in full, wrapping instead of cutting", () => {
    const call = assistant("looking");
    const result: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "c1",
      toolName: "bash",
      content: [{ type: "text", text: "refused" }],
      isError: true,
      timestamp: 2,
    };
    const denied = ["bash(date *)", "bash(ls *)", "codemode (main session only)"];
    const blocked = thread(0);
    blocked.turns = [turn(1, { messages: [call, result, assistant("done")], denied })];
    const rows = body(draw({ thread: blocked, width: 40 }).lines);
    const joined = rows.join(" ").replace(/\s+/g, " ");
    assert.ok(joined.includes("⚠ blocked:"), joined);
    for (const label of denied) assert.ok(joined.includes(label), `${label} in ${JSON.stringify(rows)}`);
    assert.ok(!joined.includes("…"));
    assert.ok(rows.indexOf("done") < rows.findIndex((row) => row.includes("blocked")), "under the answer");
  });
});

describe("activityLabel", () => {
  it("shows the command, pattern or path on one line", () => {
    assert.equal(activityLabel("bash", { command: "tinyfish search\nquery x" }), "bash tinyfish search query x");
    assert.equal(activityLabel("grep", { pattern: "TODO", path: "src" }), "grep TODO");
    assert.equal(activityLabel("read", { path: "src/x.ts" }), "read src/x.ts");
    assert.equal(activityLabel("mcp__docs__search", { query: "x" }), "mcp__docs__search");
  });
});
