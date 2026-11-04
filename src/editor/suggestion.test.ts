import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  buildSuggestionUserMessage,
  buildTranscript,
  cleanSuggestion,
  SUGGEST_SYSTEM_PROMPT,
  type TranscriptTurn,
  withGhostSuggestion,
} from "./suggestion.ts";

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

test("silence tokens mean no suggestion", () => {
  for (const word of ["NONE", "n/a", "no suggestion", "nothing", "silence", "null"]) {
    assert.equal(cleanSuggestion(word, 80), "", word);
  }
  assert.equal(cleanSuggestion("none of them", 80), "none of them");
});

test("cleanSuggestion truncates and drops empty replies", () => {
  assert.equal(cleanSuggestion("x".repeat(200), 80), "x".repeat(80));
  assert.equal(cleanSuggestion("  \n \n", 80), "");
});

function turns(...items: [TranscriptTurn["role"], string][]): TranscriptTurn[] {
  return items.map(([role, text]) => ({ role, text }));
}

test("the transcript is role-labeled, oldest last, and keeps the whole newest reply", () => {
  const transcript = buildTranscript(
    turns(
      ["user", "把测试跑起来"],
      ["assistant", "跑了 npm test,3 个失败,我改一下。"],
      ["user", "顺便看看 CI"],
      ["assistant", "CI 也是同一个原因,已修复,全绿。"],
    ),
  );
  assert.equal(
    transcript,
    [
      "User: 把测试跑起来",
      "Agent: 跑了 npm test,3 个失败,我改一下。",
      "User: 顺便看看 CI",
      "Agent: CI 也是同一个原因,已修复,全绿。",
    ].join("\n\n"),
  );
});

test("transcript caps earlier messages and gives the newest reply the remaining budget", () => {
  const transcript = buildTranscript(turns(["user", "b".repeat(2000)], ["assistant", "a".repeat(3000)]));
  assert.ok(transcript !== undefined);
  const [userLine, agentLine] = transcript.split("\n\n");
  // The newest assistant reply gets the whole remaining budget (~8000), the user turn is capped at 1000.
  assert.ok(agentLine.length > 3000, agentLine.length.toString());
  assert.ok(userLine.startsWith("User: b"));
  assert.ok(userLine.length <= 1000 + "User: ".length + 2);
  assert.ok(userLine.endsWith("…"));
});

test("transcript without an assistant reply is undefined", () => {
  assert.equal(buildTranscript(turns(["user", "hello"])), undefined);
  assert.equal(buildTranscript([]), undefined);
});

test("the suggestion prompt carries cwd, transcript and the reply-only instruction", () => {
  const message = buildSuggestionUserMessage("/tmp/x", "User: hi\n\nAgent: hello");
  assert.ok(message.startsWith("CWD: /tmp/x"));
  assert.ok(message.includes("User: hi"));
  assert.ok(message.includes("Reply with ONLY the suggestion text."));
  assert.ok(SUGGEST_SYSTEM_PROMPT.includes("A wrong line is worse than NONE."));
  assert.ok(SUGGEST_SYSTEM_PROMPT.includes("2-12 words in their style."));
});
