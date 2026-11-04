import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { Drawer, type DrawerView } from "./drawer.ts";
import type { BtwThread, BtwTurn } from "./thread.ts";

initTheme("dark");

function turn(index: number): BtwTurn {
  return {
    text: `question ${index}`,
    question: `question ${index}`,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: `answer ${index}` }],
        provider: "probe",
        model: "probe-model",
        api: "openai-completions",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 1,
      } as AssistantMessage,
    ],
    askedAt: index,
    durationMs: 1000,
    denied: [],
  };
}

function setup(turns: number) {
  const thread: BtwThread = {
    id: "btw-1",
    anchorEntryId: "e1",
    anchorTurns: 1,
    turns: Array.from({ length: turns }, (_, index) => turn(index + 1)),
  };
  const view: DrawerView = { open: true, thread, number: 1, mainTurns: 1, revision: 0 };
  // 16 terminal rows: an 8-row drawer, 3 body rows inside its borders, padding and the gap under it.
  const drawer = new Drawer({ view: () => view, theme: testTheme(), terminalRows: () => 16, now: () => 0 });
  const text = () => drawer.render(60).map(stripTerminalSequences).join("\n");
  return { thread, view, drawer, text };
}

function wheel(delta: number): TuiMouseEvent {
  return {
    type: "wheel",
    button: "none",
    x: 1,
    y: 1,
    screenX: 1,
    screenY: 1,
    width: 60,
    height: 8,
    shift: false,
    alt: false,
    ctrl: false,
    wheelDelta: delta,
  } as TuiMouseEvent;
}

describe("Drawer", () => {
  it("draws nothing while closed", () => {
    const { view, drawer } = setup(1);
    view.open = false;
    view.revision++;
    assert.deepEqual(drawer.render(60), []);
  });

  it("scrolls with the wheel, and follows the newest row again at the bottom", () => {
    const { drawer, text, thread, view } = setup(10);
    assert.ok(text().includes("answer 10"));
    assert.deepEqual(drawer.handleMouse(wheel(-100)), { handled: true });
    assert.ok(text().includes("question 1"), "wheel up reaches the first question");
    assert.ok(!text().includes("answer 10"));

    drawer.handleMouse(wheel(100));
    thread.turns.push(turn(11));
    view.revision++;
    assert.ok(text().includes("answer 11"), "back at the bottom, a new turn shows up");
  });

  it("keeps the view still while scrolled up and new rows arrive", () => {
    const { drawer, text, thread, view } = setup(10);
    text();
    drawer.handleMouse(wheel(-100));
    const before = text();
    thread.turns.push(turn(11));
    view.revision++;
    assert.equal(text().replace(/[↑↓] \d+/g, ""), before.replace(/[↑↓] \d+/g, ""));
    drawer.follow();
    assert.ok(text().includes("answer 11"));
  });

  it("pages by the body height less one row", () => {
    const { drawer, text } = setup(10);
    text();
    drawer.page(-1);
    const rows = text().split("\n");
    assert.match(rows.at(-2) ?? "", /↓ 2/);
  });

  it("draws the running question with its phase", () => {
    const { view, text } = setup(1);
    view.pending = { question: "next?", answer: "", phase: "read src/x.ts", startedAt: 0 };
    view.revision++;
    assert.ok(text().includes("read src/x.ts · 0.0s"), text());
  });

  it("leaves other mouse events to Pi", () => {
    const { drawer } = setup(3);
    assert.equal(drawer.handleMouse({ ...wheel(0), type: "click" }), undefined);
  });

  it("returns its previous lines while nothing changed", () => {
    const { drawer, view } = setup(3);
    const first = drawer.render(60);
    assert.equal(drawer.render(60), first);
    view.revision++;
    assert.notEqual(drawer.render(60), first);
  });
});
