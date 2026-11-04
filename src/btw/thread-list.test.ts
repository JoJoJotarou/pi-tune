import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import type { BtwThread } from "./thread.ts";
import { NEW_THREAD, ThreadList, threadItems } from "./thread-list.ts";

initTheme("dark");

function thread(id: string, anchorTurns: number, questions: string[]): BtwThread {
  return {
    id,
    anchorEntryId: `e${anchorTurns}`,
    anchorTurns,
    turns: questions.map((question, index) => ({
      text: question,
      question,
      message: { role: "assistant", content: [] } as unknown as AssistantMessage,
      askedAt: index,
      durationMs: 1,
    })),
  };
}

const threads = [thread("a", 1, ["what does read do?", "and bash?"]), thread("b", 4, ["is the cache hit?"])];

describe("threadItems", () => {
  it("offers a new thread first, then the threads newest first by their first question", () => {
    const items = threadItems(threads, 6);
    assert.deepEqual(
      items.map((item) => [item.value, item.label]),
      [
        [NEW_THREAD, "New thread"],
        ["b", "#2 is the cache hit?"],
        ["a", "#1 what does read do?"],
      ],
    );
    assert.equal(items[1].description, "1 turn · @turn 4 · main +2");
    assert.equal(items[2].description, "2 turns · @turn 1 · main +5");
  });
});

describe("ThreadList", () => {
  function open(selected?: string) {
    let picked: string | undefined | null = null;
    const list = new ThreadList({
      items: threadItems(threads, 6),
      selected,
      tui: { requestRender() {} },
      theme: testTheme(),
      done: (value) => {
        picked = value;
      },
    });
    return { list, picked: () => picked };
  }

  it("starts on the given thread and opens the one picked with enter", () => {
    const { list, picked } = open("a");
    assert.ok(list.render(60).some((row) => stripTerminalSequences(row).includes("→ #1 what does read do?")));
    list.handleInput("\x1b[A");
    list.handleInput("\r");
    assert.equal(picked(), "b");
  });

  it("cancels with esc", () => {
    const { list, picked } = open();
    list.handleInput("\x1b");
    assert.equal(picked(), undefined);
  });

  it("fits narrow terminals", () => {
    const { list } = open();
    for (const row of list.render(30)) assert.ok(visibleWidth(row) <= 30, stripTerminalSequences(row));
  });
});
