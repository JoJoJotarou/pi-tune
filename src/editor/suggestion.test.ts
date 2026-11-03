import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSuggestionPrompt, cleanSuggestion, digestFromReply, withGhostSuggestion } from "./suggestion.ts";

const GHOST_CLEAR = "\x1b_pi:fc\x07";
const GHOST_RESTORE = "\x1b_pi:/fc\x07";

/** Empty inner content row as Pi renders it: the marker-wrapped cursor cell plus padding. */
function emptyRow(width: number): string {
  return `${GHOST_CLEAR} ${GHOST_RESTORE}${" ".repeat(width - 1)}`;
}

test("ghost text goes after the cursor cell and preserves the row width", () => {
  const row = withGhostSuggestion(emptyRow(60), "run the tests", (t) => `\x1b[2m${t}\x1b[0m`, 58);
  assert.equal(visibleWidth(row), 58);
  assert.ok(row.includes("run the tests"));
  // The cursor cell between the markers stays a single cell, so the TUI's block cursor is untouched.
  assert.ok(row.includes(`${GHOST_CLEAR} ${GHOST_RESTORE}\x1b[2mrun the tests`));
});

test("long suggestions truncate to the row width", () => {
  const row = withGhostSuggestion(emptyRow(40), "a".repeat(80), (t) => t, 38);
  assert.equal(visibleWidth(row), 38);
  assert.ok(row.includes(GHOST_CLEAR));
});

test("rows without the marker pair come back untouched", () => {
  const row = "plain content";
  assert.equal(
    withGhostSuggestion(row, "suggestion", (t) => t, 40),
    row,
  );
});

test("empty suggestions leave the row alone", () => {
  const row = emptyRow(30);
  assert.equal(
    withGhostSuggestion(row, "", (t) => t, 28),
    row,
  );
});

test("cleanSuggestion takes the first non-empty line and unwraps decoration", () => {
  assert.equal(cleanSuggestion("\n  `run npm test`  \n", 80), "run npm test");
  assert.equal(cleanSuggestion('"commit the changes"', 80), "commit the changes");
  assert.equal(cleanSuggestion("- write a summary", 80), "write a summary");
});

test("cleanSuggestion truncates and drops empty replies", () => {
  assert.equal(cleanSuggestion("x".repeat(200), 80), "x".repeat(80));
  assert.equal(cleanSuggestion("  \n \n", 80), "");
});

test("digestFromReply keeps the tail of long replies", () => {
  const text = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
  const digest = digestFromReply(text);
  assert.ok(digest.length <= 2000);
  assert.ok(digest.endsWith("line 199"));
  assert.equal(digestFromReply("short"), "short");
});

test("the suggestion prompt bounds the reply and states the budget", () => {
  const prompt = buildSuggestionPrompt("the reply", 80);
  assert.ok(prompt.includes("at most 80 characters"));
  assert.ok(prompt.includes("the reply"));
  assert.ok(buildSuggestionPrompt("", 80).includes("(no text)"));
});
