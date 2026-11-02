import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import type { ViewerBlock } from "./blocks.ts";
import { ViewerComponent } from "./component.ts";

const code: ViewerBlock = {
  kind: "code",
  title: "ts code",
  lang: "ts",
  body: Array.from({ length: 60 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n"),
};

function render(width: number, rows = 40, block: ViewerBlock = code): string[] {
  const component = new ViewerComponent(
    testTheme("dark"),
    [block],
    () => {},
    () => {},
    rows,
  );
  return component.render(width);
}

test("renders a bordered overlay with title, range, and hints", () => {
  const lines = render(60);

  assert.equal(lines.length, 32);
  assert.match(lines[0], /ts code · 60 lines/);
  assert.match(lines[0], /1–30\/60/);
  assert.match(lines.at(-1) ?? "", /↑↓ scroll · \/ search · y copy · \[ \] prev\/next/);
  assert.match(lines[1], /const value1 = 1;/);
  assert.equal(visibleWidth(lines[0]), 60);
  for (const line of lines) assert.ok(visibleWidth(line) <= 60, `too wide: ${JSON.stringify(line)}`);
});

test("renders at width 30 without a line wider than the width", () => {
  const lines = render(30);

  assert.match(lines[0], /1–30\/60/);
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= 30, `too wide: ${JSON.stringify(line)}`);
    assert.equal(visibleWidth(line), 30);
  }
});

test("scroll keys move the visible range", () => {
  const component = new ViewerComponent(
    testTheme("dark"),
    [code],
    () => {},
    () => {},
    40,
  );
  component.render(60);
  component.handleInput("\x1b[B");
  assert.match(component.render(60)[0], /2–31\/60/);
});

test("tool output renders in the tool output color and escape closes", () => {
  let closed = 0;
  const tool: ViewerBlock = { kind: "tool", title: "bash · seq 1 3", body: "1\n2\n3" };
  const component = new ViewerComponent(
    testTheme("dark"),
    [tool],
    () => {
      closed++;
    },
    () => {},
    40,
  );
  const lines = component.render(40);
  assert.match(lines[0], /bash · seq 1 3 · 3 lines/);
  assert.match(lines[1], /1/);
  component.handleInput("\x1b");
  assert.equal(closed, 1);
});
