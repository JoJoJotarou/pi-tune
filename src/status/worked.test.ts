import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { assertFits } from "../../test/width.ts";
import { workedEntry } from "./worked.ts";

const theme = testTheme("dark");

function rows(data: { ms: number } | undefined, width: number): string[] {
  const entry = workedEntry(data, theme);
  assert.ok(entry, "the entry should render");
  return entry.render(width);
}

test("no data means no entry", () => {
  assert.equal(workedEntry(undefined, theme), undefined);
});

test("a non-finite duration means no entry", () => {
  for (const ms of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(workedEntry({ ms }, theme), undefined);
  }
});

test("a finished run is one dim transcript line at width 80", () => {
  assert.deepEqual(rows({ ms: 2900 }, 80).map(stripTerminalSequences), [" Worked for 2.9s"]);
  assertFits(rows({ ms: 2900 }, 80), 80);
});

test("the line keeps the same text and fits at width 20", () => {
  const lines = rows({ ms: 2900 }, 20);
  assert.deepEqual(lines.map(stripTerminalSequences), [" Worked for 2.9s"]);
  assertFits(lines, 20);
});

test("a long duration is cut to the width it is given", () => {
  const lines = rows({ ms: 90_000 }, 8);
  assert.deepEqual(lines.map(stripTerminalSequences), [" Worked…"]);
  assertFits(lines, 8);
});
