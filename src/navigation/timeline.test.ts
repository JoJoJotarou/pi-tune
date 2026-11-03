import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { ScrollView, stripTerminalSequences, VStack, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { collectPrompts } from "../internals/transcript.ts";
import {
  cardTextWidth,
  hitTest,
  hoverCardLines,
  hoverCardState,
  jumpTarget,
  railRows,
  type TimelineGeometry,
  TimelineHoverCard,
  TimelineRail,
  timelineGeometry,
} from "./timeline.ts";

initTheme("dark", false);

const plain = (line: string) => stripTerminalSequences(line);

function prompts(rows: number[]): { row: number; text: string }[] {
  return rows.map((row, index) => ({ row, text: `prompt ${index + 1}` }));
}

function geometry(overrides: Partial<Parameters<typeof timelineGeometry>[0]> = {}): TimelineGeometry {
  const result = timelineGeometry({
    prompts: prompts([0, 30, 60, 90]),
    viewportTop: 0,
    height: 20,
    atBottom: false,
    ...overrides,
  });
  assert.ok(result);
  return result;
}

test("hides the rail below two prompts or without room for a tick", () => {
  assert.equal(timelineGeometry({ prompts: prompts([0]), viewportTop: 0, height: 20, atBottom: false }), undefined);
  assert.equal(timelineGeometry({ prompts: prompts([0, 5]), viewportTop: 0, height: 2, atBottom: false }), undefined);
});

test("small conversations show every tick centered between the chevrons", () => {
  const rail = geometry();

  assert.deepEqual([rail.start, rail.end], [0, 4]);
  // 4 ticks + 2 chevrons = 6 rows centered in 20: top = 7.
  assert.equal(rail.upY, 7);
  assert.equal(rail.ticksY, 8);
  assert.equal(rail.downY, 12);
});

test("active is the prompt that owns the first visible row", () => {
  assert.equal(geometry({ viewportTop: 0 }).active, 0);
  assert.equal(geometry({ viewportTop: 29 }).active, 0);
  assert.equal(geometry({ viewportTop: 30 }).active, 1);
  assert.equal(geometry({ viewportTop: 95 }).active, 3);
  assert.equal(geometry({ viewportTop: -1 }).active, undefined);
});

test("chevron targets are the nearest prompts around the viewport top, not active plus or minus one", () => {
  const rail = geometry({ viewportTop: 30 });

  assert.equal(rail.active, 1);
  assert.equal(rail.upTarget, 0);
  assert.equal(rail.downTarget, 2);
  // Inside an answer, the prompt at the top is also the nearest one above it.
  const inside = geometry({ viewportTop: 35 });
  assert.equal(inside.upTarget, 1);
  assert.equal(inside.downTarget, 2);
  assert.equal(jumpTarget(rail, { kind: "up" }), 0);
  assert.equal(jumpTarget(rail, { kind: "down" }), 2);
  assert.equal(jumpTarget(rail, { kind: "tick", index: 3 }), 3);

  const top = geometry({ viewportTop: 0 });
  assert.equal(top.upTarget, undefined);
  assert.equal(top.downTarget, 1);
});

test("more prompts than rows window around the active one and pin the tail at the bottom", () => {
  const rows = Array.from({ length: 50 }, (_, index) => index * 10);
  const centered = geometry({ prompts: prompts(rows), viewportTop: 250, height: 20 });
  assert.equal(centered.end - centered.start, 18);
  assert.ok(centered.start <= 25 && 25 < centered.end);
  assert.equal(centered.start, 25 - 9);

  const tail = geometry({ prompts: prompts(rows), viewportTop: 490, height: 20, atBottom: true });
  assert.deepEqual([tail.start, tail.end], [32, 50]);
});

test("hit-tests chevrons, ticks and empty rows", () => {
  const rail = geometry({ viewportTop: 35, height: 20, prompts: prompts([0, 30, 60, 90]) });

  assert.deepEqual(hitTest(rail, rail.upY), { kind: "up" });
  assert.deepEqual(hitTest(rail, rail.downY), { kind: "down" });
  assert.deepEqual(hitTest(rail, rail.ticksY), { kind: "tick", index: 0 });
  assert.deepEqual(hitTest(rail, rail.ticksY + 3), { kind: "tick", index: 3 });
  assert.equal(hitTest(rail, rail.upY - 1), undefined);
  assert.equal(hitTest(rail, 19), undefined);
});

test("tick and chevron glyphs follow state", () => {
  const theme = testTheme("dark");
  const rail = geometry({ viewportTop: 30 });
  const rows = railRows(rail, { kind: "tick", index: 2 }, theme);

  assert.equal(plain(rows[rail.upY]), " ▴");
  assert.equal(plain(rows[rail.downY]), " ▾");
  assert.equal(plain(rows[rail.ticksY]), " ─");
  assert.equal(plain(rows[rail.ticksY + 1]), "━━");
  assert.equal(plain(rows[rail.ticksY + 2]), "──");
  for (const row of rows) assert.equal(visibleWidth(row), 2);
});

test("a chevron with nothing to jump to is dim", () => {
  const theme = testTheme("dark");
  const rail = geometry({ viewportTop: 0 });
  const rows = railRows(rail, { kind: "up" }, theme);

  assert.equal(plain(rows[rail.upY]), " ▴");
  assert.equal(rows[rail.upY], ` ${theme.fg("dim", "▴")}`);
  assert.equal(rows[rail.downY], ` ${theme.fg("muted", "▾")}`);
  const hovered = railRows(rail, { kind: "down" }, theme);
  assert.equal(hovered[rail.downY], ` ${theme.fg("text", "▾")}`);
});

test("hover card wraps a prompt into at most two lines and ellipsizes the second", () => {
  assert.deepEqual(hoverCardLines("short question", 32), ["short question"]);
  assert.deepEqual(hoverCardLines("first\nsecond", 32), ["first second"]);
  assert.deepEqual(hoverCardLines("a".repeat(40), 16).map(plain), ["a".repeat(16), `${"a".repeat(15)}…`]);
  assert.deepEqual(hoverCardLines("   ", 16), []);
  assert.equal(cardTextWidth(40), 20);
  assert.equal(cardTextWidth(10), 16);
  assert.equal(cardTextWidth(200), 32);
});

test("hover card sits left of the rail, centered on the tick and clamped to the screen", () => {
  const middle = hoverCardState("a question", 10, 100, 30);
  assert.ok(middle);
  assert.equal(middle.width, "a question".length + 4);
  assert.equal(middle.col, 100 - 2 - middle.width);
  assert.equal(middle.row, 10 - 1);

  const top = hoverCardState("a question", 0, 100, 30);
  assert.equal(top?.row, 0);
  const bottom = hoverCardState("a question", 29, 100, 30);
  assert.equal(bottom?.row, 30 - 3);
});

test("the hover card hides itself when the pointer reaches it", () => {
  const card = new TimelineHoverCard(() => testTheme("dark"));
  const state = hoverCardState("a question", 10, 100, 30);
  assert.ok(state);
  let dismissed = 0;
  card.onDismiss = () => dismissed++;
  card.show(state);

  assert.deepEqual(card.handleMouse(mouse({ type: "move", button: "none" })), { handled: true, render: true });
  assert.deepEqual(card.render(state.width), []);
  assert.equal(dismissed, 1);

  card.show(state);
  assert.equal(card.handleMouse(mouse({ type: "wheel", button: "none", wheelDelta: -1 })), undefined);
  assert.deepEqual(card.render(state.width), []);
});

test("the hover card renders a rounded frame no wider than its width", () => {
  const card = new TimelineHoverCard(() => testTheme("dark"));
  const state = hoverCardState("a question that is long enough to wrap", 10, 100, 30);
  assert.ok(state);
  card.show(state);

  const lines = card.render(state.width);
  assert.equal(lines.length, 4);
  assert.equal(plain(lines[0])[0], "╭");
  assert.equal(plain(lines[3])[0], "╰");
  for (const line of lines) assert.equal(visibleWidth(line), state.width);
  card.hide();
  assert.deepEqual(card.render(state.width), []);
});

function fakeTui(children: Component[] = [], viewportTop = 0) {
  const chat: { children: Component[]; render: () => string[] } = { children, render: () => [] };
  const document = {
    children: [{ render: () => [] }, { render: () => [] }, chat],
    render: () => [],
    addChild: () => {},
  };
  const tui = {
    children: [document],
    layoutRoot: new VStack([new ScrollView(document as never, { primary: true })]),
    terminal: { columns: 80, rows: 30 },
    viewportTop,
    scrollTop: viewportTop,
    scrollBy(lines: number) {
      tui.scrollTop += lines;
    },
    requestRender() {},
  };
  return tui;
}

function mouse(overrides: Partial<TuiMouseEvent>): TuiMouseEvent {
  return {
    type: "click",
    button: "left",
    x: 0,
    y: 0,
    screenX: 79,
    screenY: 0,
    width: 2,
    height: 30,
    shift: false,
    alt: false,
    ctrl: false,
    ...overrides,
  };
}

function railWith(children: Component[], viewportTop = 0) {
  const tui = fakeTui(children, viewportTop);
  const card = new TimelineHoverCard(() => testTheme("dark"));
  const rail = new TimelineRail(
    tui as never,
    () => testTheme("dark"),
    () => {},
    card,
  );
  return { tui, card, rail };
}

function conversation(): Component[] {
  return [
    new UserMessageComponent("first question"),
    { render: () => Array.from({ length: 40 }, () => "answer"), invalidate: () => {} },
    new UserMessageComponent("second question"),
    { render: () => Array.from({ length: 40 }, () => "answer"), invalidate: () => {} },
  ];
}

test("the rail is hidden with a single prompt", () => {
  const { rail } = railWith([new UserMessageComponent("only question")]);

  assert.equal(rail.visible(), false);
  assert.deepEqual(rail.render(2), []);
});

test("leaves wheel events over the rail unhandled so Pi scrolls", () => {
  const { rail } = railWith(conversation());
  assert.equal(rail.handleMouse(mouse({ type: "wheel", button: "none", wheelDelta: -3 })), undefined);
});

test("leaves non-left clicks unhandled and handles left clicks", () => {
  const { rail } = railWith(conversation());
  assert.deepEqual(rail.handleMouse(mouse({ button: "right" })), { handled: true });
  assert.deepEqual(rail.handleMouse(mouse({})), { handled: true });
});

test("a click on a tick jumps to that prompt", () => {
  const { rail, tui } = railWith(conversation(), 20);
  const layout = rail.visible();
  assert.equal(layout, true);
  const rows = rail.render(2);
  const tickRow = rows.findIndex((row) => plain(row) === " ─");

  rail.handleMouse(mouse({ y: tickRow }));
  const prompts = collectPrompts(tui as never);
  assert.ok(!(prompts instanceof Error));
  assert.equal(tui.scrollTop, prompts.prompts[1].row);
});

test("hovering a tick shows the card and moving off the tick hides it", () => {
  const { rail, card } = railWith(conversation(), 20);
  assert.equal(rail.visible(), true);
  const rows = rail.render(2);
  const tickRow = rows.findIndex((row) => plain(row) === " ─");

  rail.handleMouse(mouse({ type: "move", button: "none", y: tickRow }));
  const shown = card.render(40);
  assert.ok(
    shown.some((line) => plain(line).includes("question")),
    shown.join("\n"),
  );

  rail.handleMouse(mouse({ type: "move", button: "none", y: 0 }));
  assert.deepEqual(card.render(40), []);
});

test("renders with the theme current at render time", () => {
  const themes = [testTheme("dark"), testTheme("light")];
  let current = 0;
  const tui = fakeTui(conversation());
  const rail = new TimelineRail(
    tui as never,
    () => themes[current],
    () => {},
  );

  const before = rail.render(2);
  current = 1;
  const after = rail.render(2);

  assert.ok(before.length > 0);
  assert.notDeepEqual(after, before);
});
