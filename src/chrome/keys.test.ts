import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { type KeyGroup, KeysComponent, keysContentLines } from "./keys.ts";

initTheme("dark");
const theme = testTheme("dark");

const groups: KeyGroup[] = [
  {
    title: "Pi",
    entries: [
      { key: "escape", description: "Cancel or abort" },
      { key: "ctrl+o", description: "Toggle tool output" },
    ],
  },
  {
    title: "pi-tune",
    entries: [
      { key: "alt+o", description: "View the latest output block" },
      { key: "ctrl+s", description: "Stash the draft" },
      { key: "click", description: "Expand a tool or thinking block" },
    ],
  },
];

function plain(text: string): string {
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}

test("keys modal renders a framed two-column list with title and hints", () => {
  let closed = false;
  const component = new KeysComponent(
    groups,
    theme,
    () => {
      closed = true;
    },
    () => {},
    30,
  );
  const lines = component.render(80);

  assert.ok(lines[0].includes("Keys"), lines[0]);
  assert.ok(lines[0].includes("╭"), lines[0]);
  assert.ok(plain(lines[lines.length - 1]).includes("↑↓ scroll · esc close"), lines[lines.length - 1]);
  for (const line of lines) assert.ok(visibleWidth(line) <= 80, `${visibleWidth(line)}: ${line}`);

  const body = lines.slice(1, -1);
  assert.ok(body.some((line) => plain(line).includes("Pi")));
  assert.ok(body.some((line) => plain(line).includes("pi-tune")));
  assert.ok(body.some((line) => line.includes(theme.fg("accent", "ctrl+s"))));
  assert.ok(body.some((line) => plain(line).includes("Stash the draft")));
  assert.equal(closed, false);
});

test("keys modal scrolls and closes on escape", () => {
  let closed = false;
  const many: KeyGroup[] = [
    {
      title: "Pi",
      entries: Array.from({ length: 30 }, (_, index) => ({
        key: `key${index}`,
        description: `Action ${index}`,
      })),
    },
  ];
  const component = new KeysComponent(
    many,
    theme,
    () => {
      closed = true;
    },
    () => {},
    30,
  );
  const first = component.render(70);
  component.handleInput("\x1b[B");
  const second = component.render(70);
  assert.notEqual(first[1], second[1]);
  component.handleInput("\x1b");
  assert.equal(closed, true);
});

test("keys list stays inside narrow widths", () => {
  const lines = keysContentLines(groups, 20, 10, 0, theme);
  assert.equal(lines.length, 10);
  for (const line of lines) assert.ok(visibleWidth(line) <= 16, `${visibleWidth(line)}: ${line}`);
});
