import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { Component, TuiMouseEvent } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { TimelineRail } from "./timeline.ts";

initTheme("dark", false);

function fakeTui(children: Component[] = []) {
  const chat: { children: Component[]; render: () => string[] } = { children, render: () => [] };
  const document = {
    children: [{ render: () => [] }, { render: () => [] }, chat],
    render: () => [],
    addChild: () => {},
  };
  return {
    children: [document],
    terminal: { columns: 80, rows: 30 },
    viewportTop: 0,
    scrollBy: () => {},
  };
}

function mouse(overrides: Partial<TuiMouseEvent>): TuiMouseEvent {
  return {
    type: "click",
    button: "left",
    x: 0,
    y: 0,
    screenX: 79,
    screenY: 0,
    width: 1,
    height: 30,
    shift: false,
    alt: false,
    ctrl: false,
    ...overrides,
  };
}

function rail(children: Component[] = []) {
  return new TimelineRail(
    fakeTui(children) as never,
    () => testTheme("dark"),
    () => {},
  );
}

test("leaves wheel events over the rail unhandled so Pi scrolls", () => {
  assert.equal(rail().handleMouse(mouse({ type: "wheel", button: "none", wheelDelta: -3 })), undefined);
});

test("leaves non-left clicks over the rail unhandled", () => {
  assert.equal(rail().handleMouse(mouse({ button: "right" })), undefined);
  assert.equal(rail().handleMouse(mouse({ type: "move", button: "none" })), undefined);
});

test("handles a left click over the rail", () => {
  assert.deepEqual(rail().handleMouse(mouse({})), { handled: true });
});

test("renders with the theme current at render time", () => {
  const themes = [testTheme("dark"), testTheme("light")];
  let current = 0;
  const tui = fakeTui([
    new UserMessageComponent("first question"),
    { render: () => Array.from({ length: 60 }, () => "answer"), invalidate: () => {} },
  ]);
  const liveRail = new TimelineRail(
    tui as never,
    () => themes[current],
    () => {},
  );

  const before = liveRail.render();
  current = 1;
  const after = liveRail.render();

  assert.ok(before.length > 0);
  assert.notDeepEqual(after, before);
});
