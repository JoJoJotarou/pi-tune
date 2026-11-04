import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { type DrawerInput, drawerMaxHeight, renderBtw } from "./render.ts";
import type { BtwThread } from "./thread.ts";

initTheme("dark");
const theme = testTheme();
const markdown = getMarkdownTheme();

function assistant(
  text: string,
  usage = { input: 200, output: 120, cacheRead: 7800, cacheWrite: 0, totalTokens: 8120 },
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "probe",
    model: "probe-model",
    api: "openai-completions",
    usage: {
      ...usage,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  } as AssistantMessage;
}

function thread(turns: number, anchorTurns = 3): BtwThread {
  return {
    id: "btw-1",
    anchorEntryId: "e3",
    anchorTurns,
    turns: Array.from({ length: turns }, (_, index) => ({
      text: `question ${index + 1}`,
      question: `question ${index + 1}`,
      message: assistant(`answer ${index + 1}`),
      askedAt: index,
      durationMs: 3200,
    })),
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
    for (const width of [100, 40, 30]) {
      for (const maxHeight of [6, 10, 16]) {
        for (const turns of [0, 1, 3, 40]) {
          for (const pending of [undefined, { question: long, answer: long, elapsedMs: 1200, spinner: "⠋" }]) {
            const { lines } = draw({ thread: thread(turns), width, maxHeight, pending });
            assert.ok(lines.length <= maxHeight, `${width}x${maxHeight}: ${lines.length} rows`);
            for (const line of lines)
              assert.ok(visibleWidth(line) <= width, `too wide at ${width}: ${stripTerminalSequences(line)}`);
          }
        }
      }
    }
  });

  it("takes only the rows its content needs", () => {
    assert.equal(draw({ thread: thread(1) }).lines.length, 5, "question, answer, meta, two borders");
    assert.equal(draw({ thread: thread(12), maxHeight: 16 }).lines.length, 16, "capped at maxHeight");
  });

  it("follows the newest row, and shows older rows from an explicit top", () => {
    const newest = draw({ thread: thread(12), maxHeight: 8 });
    const text = plain(newest.lines).join("\n");
    assert.ok(text.includes("answer 12"), "newest answer is visible");
    assert.ok(!text.includes("question 1\n") && !text.includes("question 1 "), "oldest question is cut");
    assert.equal(newest.top, newest.maxTop);
    assert.equal(newest.pageRows, 6);

    const oldest = plain(draw({ thread: thread(12), maxHeight: 8, top: 0 }).lines).join("\n");
    assert.ok(oldest.includes("question 1"), "top 0 starts at the first question");
    assert.ok(!oldest.includes("answer 12"));

    assert.equal(draw({ thread: thread(12), maxHeight: 8, top: 999 }).top, newest.maxTop, "top is clamped");
  });

  it("counts the rows above and below on the bottom border", () => {
    const newest = plain(draw({ thread: thread(12), maxHeight: 8 }).lines).at(-1) ?? "";
    assert.match(newest, /↑ \d+/);
    assert.doesNotMatch(newest, /↓ \d+/);
    const oldest = plain(draw({ thread: thread(12), maxHeight: 8, top: 0 }).lines).at(-1) ?? "";
    assert.match(oldest, /↓ \d+/);
    assert.doesNotMatch(oldest, /↑ \d+/);
  });

  it("puts the anchor on the top border and marks main turns the thread cannot see", () => {
    const behind = plain(draw({ thread: thread(1, 3), mainTurns: 8 }).lines)[0];
    assert.ok(behind.includes("btw #1"), behind);
    assert.ok(behind.includes("@turn 3 · main 8 (+5)"), behind);
    const inSync = plain(draw({ thread: thread(1, 3), mainTurns: 3 }).lines)[0];
    assert.ok(inSync.includes("@turn 3 · main 3"), inSync);
    assert.ok(!inSync.includes("(+"), inSync);
  });

  it("names the keys that work right now", () => {
    const idle = plain(draw().lines).at(-1) ?? "";
    assert.ok(idle.includes("enter ask") && idle.includes("esc close"), idle);
    assert.ok(!idle.includes("scroll"), "no scroll hint while everything fits");
    const long = plain(draw({ thread: thread(12), maxHeight: 8, width: 120 }).lines).at(-1) ?? "";
    assert.ok(long.includes("shift+↑↓ scroll"), long);
    const narrow = plain(draw({ thread: thread(12), maxHeight: 8, width: 40 }).lines).at(-1) ?? "";
    assert.ok(narrow.includes("enter ask") && narrow.includes("↑ "), narrow);
    assert.ok(!narrow.includes("…"), `hints are dropped whole: ${narrow}`);
    const running =
      plain(draw({ pending: { question: "q", answer: "", elapsedMs: 0, spinner: "⠋" } }).lines).at(-1) ?? "";
    assert.ok(running.includes("esc stop"), running);
    assert.ok(!running.includes("enter ask"), running);
  });

  it("shows a running question at once, then the answer as it streams", () => {
    const waiting = plain(draw({ pending: { question: "why?", answer: "", elapsedMs: 1200, spinner: "⠙" } }).lines);
    assert.ok(waiting.some((row) => row.includes("you why?")));
    assert.ok(
      waiting.some((row) => row.includes("btw ⠙ answering · 1.2s")),
      waiting.join("\n"),
    );

    const streaming = plain(
      draw({ pending: { question: "why?", answer: "because it", elapsedMs: 2500, spinner: "⠹" } }).lines,
    );
    assert.ok(streaming.some((row) => row.includes("btw because it")));
    assert.ok(
      streaming.some((row) => row.includes("⠹ 2.5s")),
      streaming.join("\n"),
    );
  });

  it("explains a new thread before its first question", () => {
    const fresh = plain(draw({ thread: null, number: 2, mainTurns: 4 }).lines);
    assert.ok(fresh[0].includes("btw #2"), fresh[0]);
    assert.ok(fresh.join("\n").includes("Ask a side question"), fresh.join("\n"));
  });

  it("renders the answer as Markdown with a usage row", () => {
    const rich: BtwThread = {
      ...thread(0),
      turns: [
        {
          text: "q",
          question: "q",
          message: assistant("use **bold** and `code`"),
          askedAt: 0,
          durationMs: 3200,
        },
      ],
    };
    const rows = plain(draw({ thread: rich }).lines).join("\n");
    assert.ok(rows.includes("use bold and code"), rows);
    assert.ok(!rows.includes("**"), rows);
    assert.ok(rows.includes("probe-model · 3.2s · 8.1k tok · cache 7.8k/8k"), rows);
  });
});
