import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { drawerMaxHeight, renderBtw } from "./render.ts";
import type { BtwThread } from "./thread.ts";

const theme = testTheme();

function assistant(
  text: string,
  usage = { input: 8000, output: 120, cacheRead: 7800, cacheWrite: 0, totalTokens: 8120 },
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
    })),
  };
}

function plain(lines: string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line));
}

describe("drawerMaxHeight", () => {
  it("keeps the collapsed drawer readable and the transcript visible", () => {
    assert.equal(drawerMaxHeight(40, false), 12);
    assert.equal(drawerMaxHeight(24, false), 10);
    assert.equal(drawerMaxHeight(20, false), 8);
    assert.equal(drawerMaxHeight(12, false), 6);
  });

  it("expands to everything but six rows", () => {
    assert.equal(drawerMaxHeight(40, true), 34);
    assert.equal(drawerMaxHeight(12, true), 8);
  });
});

describe("renderBtw", () => {
  const sizes = [
    { width: 100, maxHeight: 12 },
    { width: 40, maxHeight: 6 },
    { width: 30, maxHeight: 8 },
  ];

  it("never draws a line wider than the width it was given, and never more rows than allowed", () => {
    for (const { width, maxHeight } of sizes) {
      for (const turns of [0, 1, 3, 40]) {
        const lines = renderBtw({ thread: thread(turns), mainTurns: 3, composing: false, maxHeight, width, theme });
        assert.ok(lines.length <= maxHeight, `${width}x${maxHeight}: ${lines.length} rows`);
        assert.ok(lines.length >= 4, `${width}x${maxHeight}: borders plus a row`);
        for (const line of lines)
          assert.ok(visibleWidth(line) <= width, `too wide at ${width}: ${stripTerminalSequences(line)}`);
      }
    }
  });

  it("takes only the rows its content needs", () => {
    const one = renderBtw({ thread: thread(1), mainTurns: 3, composing: false, maxHeight: 12, width: 80, theme });
    const many = renderBtw({ thread: thread(6), mainTurns: 3, composing: false, maxHeight: 12, width: 80, theme });
    assert.equal(one.length, 4, "one exchange plus two borders");
    assert.equal(many.length, 12, "capped at maxHeight");
  });

  it("shows the newest exchange when the thread does not fit", () => {
    const lines = plain(
      renderBtw({ thread: thread(12), mainTurns: 3, composing: false, maxHeight: 8, width: 60, theme }),
    );
    assert.ok(lines.join("\n").includes("question 12"), "newest question is visible");
    assert.ok(!lines.join("\n").includes("question 1 "), "oldest question is cut");
  });

  it("warns about main turns the thread cannot see", () => {
    const behind = plain(
      renderBtw({ thread: thread(1, 3), mainTurns: 8, composing: false, maxHeight: 10, width: 80, theme }),
    );
    assert.ok(behind.join("\n").includes("main turns 4-8 are not in this thread"));
    const inSync = plain(
      renderBtw({ thread: thread(1, 3), mainTurns: 3, composing: false, maxHeight: 10, width: 80, theme }),
    );
    assert.ok(!inSync.join("\n").includes("are not in this thread"));
  });

  it("names the anchor in the title and the hints in the footer", () => {
    const idle = plain(
      renderBtw({ thread: thread(1), mainTurns: 4, composing: false, maxHeight: 10, width: 100, theme }),
    );
    assert.ok(idle[0].includes("btw · btw-1"));
    assert.ok(idle[0].includes("@turn 3 · main 4"));
    assert.ok(idle[idle.length - 1].includes("ctrl+shift+b ask"));

    const composing = plain(
      renderBtw({ thread: thread(1), mainTurns: 4, composing: true, maxHeight: 10, width: 100, theme }),
    );
    assert.ok(composing[composing.length - 1].includes("enter send"));
  });

  it("explains itself when there is no thread and when the thread is empty", () => {
    const none = plain(renderBtw({ thread: null, mainTurns: 0, composing: false, maxHeight: 8, width: 60, theme }));
    assert.ok(none.join("\n").includes("/btw <question> starts a side thread."));

    const empty = plain(
      renderBtw({ thread: thread(0), mainTurns: 0, composing: false, maxHeight: 8, width: 60, theme }),
    );
    assert.ok(empty.join("\n").includes("No question asked in this thread yet."));
  });

  it("adds the usage row only when expanded", () => {
    const collapsed = plain(
      renderBtw({ thread: thread(1), mainTurns: 3, composing: false, maxHeight: 10, width: 100, theme }),
    );
    assert.ok(!collapsed.join("\n").includes("cache"));

    const expanded = plain(
      renderBtw({ thread: thread(1), mainTurns: 3, composing: false, maxHeight: 20, width: 100, theme }),
    );
    assert.ok(expanded.join("\n").includes("probe/probe-model"));
    assert.ok(expanded.join("\n").includes("cache 7.8k"));
  });
});
