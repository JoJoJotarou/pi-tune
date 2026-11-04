import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { SuggestSettings } from "./suggest-settings.ts";
import {
  buildSuggestionUserMessage,
  buildTranscript,
  cleanSuggestion,
  collectSessionTurns,
  SUGGEST_PROMPTS,
  Suggestion,
  suggestReasoning,
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
});

test("the style picks the system prompt, careful unless set", async () => {
  const prompts: string[] = [];
  const { suggestion } = makeSuggestion({
    complete: async ({ systemPrompt }) => {
      prompts.push(systemPrompt);
      return "next";
    },
  });
  start(suggestion);
  suggestion.agentStart();
  await suggestion.turnEnd(assistantTurn("done"), 0);
  suggestion.applySettings({ enabled: true, style: "eager" });
  suggestion.agentStart();
  await suggestion.turnEnd(assistantTurn("done again"), 0);
  assert.deepEqual(prompts, [SUGGEST_PROMPTS.careful, SUGGEST_PROMPTS.eager]);
  assert.notEqual(SUGGEST_PROMPTS.careful, SUGGEST_PROMPTS.eager);
});

function fakeEditor() {
  const state = { text: "", ghost: undefined as string | undefined };
  return {
    state,
    getText: () => state.text,
    getSuggestion: () => state.ghost,
    setSuggestion: (text: string | undefined) => {
      state.ghost = text;
    },
  };
}

function assistantTurn(text: string) {
  return { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] };
}

function makeSuggestion(overrides: Partial<ConstructorParameters<typeof Suggestion>[0]> = {}) {
  const warnings: string[] = [];
  const editor = fakeEditor();
  const suggestion = new Suggestion({
    complete: async () => "run the tests",
    findModel: () => undefined,
    sessionModel: () => ({ id: "session" }),
    collectTurns: () => [{ role: "assistant", text: "done" }],
    cwd: () => "/tmp",
    editor: () => editor,
    notify: (message) => warnings.push(message),
    ...overrides,
  });
  return { suggestion, editor, warnings };
}

/** A fresh session with the given settings, the way the extension starts one. */
function start(suggestion: Suggestion, settings: SuggestSettings = { enabled: true }): void {
  suggestion.startSession();
  suggestion.applySettings(settings);
}

const asMessage = (value: unknown) => value as Parameters<SessionManager["appendMessage"]>[0];

test("the transcript follows the current branch, not abandoned entries", () => {
  const session = SessionManager.inMemory("/tmp");
  session.appendMessage(asMessage({ role: "user", content: "q0", timestamp: 1 }));
  const r0 = session.appendMessage(
    asMessage({ role: "assistant", content: [{ type: "text", text: "r0" }], timestamp: 2 }),
  );
  session.appendMessage(
    asMessage({ role: "assistant", content: [{ type: "text", text: "ABANDONED 1" }], timestamp: 3 }),
  );
  session.appendMessage(
    asMessage({ role: "assistant", content: [{ type: "text", text: "ABANDONED 2" }], timestamp: 4 }),
  );
  session.branch(r0);
  session.appendMessage(asMessage({ role: "user", content: "q1", timestamp: 5 }));
  session.appendMessage(asMessage({ role: "assistant", content: [{ type: "text", text: "r1" }], timestamp: 6 }));

  assert.ok(JSON.stringify(session.getEntries()).includes("ABANDONED 1"), "the abandoned branch stays in the file");
  assert.deepEqual(collectSessionTurns(session), [
    { role: "user", text: "q0" },
    { role: "assistant", text: "r0" },
    { role: "user", text: "q1" },
    { role: "assistant", text: "r1" },
  ]);
});

test("the suggestion model setting overrides the session model", async () => {
  const seen: unknown[] = [];
  const override = { id: "override" };
  const session = { id: "session" };
  const { suggestion } = makeSuggestion({
    findModel: (provider, id) => (provider === "provider" && id === "model" ? override : undefined),
    sessionModel: () => session,
    complete: async ({ model }) => {
      seen.push(model);
      return "next";
    },
  });
  start(suggestion, { enabled: true, model: "provider/model" });
  suggestion.agentStart();
  await suggestion.turnEnd(assistantTurn("done"), 0);
  assert.deepEqual(seen, [override]);
});

test("a reply that lands while the user is typing is kept and shown when the editor empties", async () => {
  let reply!: (text: string) => void;
  const { suggestion, editor } = makeSuggestion({
    complete: () => new Promise<string>((resolve) => (reply = resolve)),
  });
  start(suggestion);
  suggestion.agentStart();
  const pending = suggestion.turnEnd(assistantTurn("done"), 0);
  editor.state.text = "hello";
  reply("run the tests");
  await pending;
  assert.equal(editor.getSuggestion(), "run the tests", "the reply was dropped while the editor had text");
  editor.state.text = "";
  assert.equal(editor.getSuggestion(), "run the tests");
});

test("a new run aborts the request and leaves no suggestion", async () => {
  let reply!: (text: string) => void;
  let signal: AbortSignal | undefined;
  const { suggestion, editor } = makeSuggestion({
    complete: ({ signal: requestSignal }) => {
      signal = requestSignal;
      return new Promise<string>((resolve) => (reply = resolve));
    },
  });
  start(suggestion);
  suggestion.agentStart();
  const pending = suggestion.turnEnd(assistantTurn("done"), 0);
  suggestion.agentStart();
  reply("late suggestion");
  await pending;
  assert.equal(signal?.aborted, true);
  assert.equal(editor.getSuggestion(), undefined);
});

test("a failed request warns once and stops asking for the session", async () => {
  let requests = 0;
  const { suggestion, warnings } = makeSuggestion({
    complete: async () => {
      requests++;
      throw new Error("provider exploded");
    },
  });
  start(suggestion);
  suggestion.agentStart();
  await suggestion.turnEnd(assistantTurn("done"), 0);
  assert.equal(requests, 1);
  assert.deepEqual(warnings, ["Next-step suggestion failed: provider exploded"]);

  suggestion.agentStart();
  await suggestion.turnEnd(assistantTurn("done again"), 0);
  suggestion.agentStart();
  await suggestion.agentSettled(false);
  assert.equal(requests, 1, "a failed request was retried in the same session");
  assert.equal(warnings.length, 1);
});

test("changing the settings after a failure asks again", async () => {
  let requests = 0;
  const { suggestion } = makeSuggestion({
    complete: async () => {
      requests++;
      throw new Error("bad key");
    },
    findModel: (provider, id) => ({ provider, id }),
  });
  start(suggestion);
  suggestion.agentStart();
  await suggestion.turnEnd(assistantTurn("done"), 0);
  suggestion.applySettings({ enabled: true, model: "cheap/mini" });
  suggestion.agentStart();
  await suggestion.turnEnd(assistantTurn("done again"), 0);
  assert.equal(requests, 2);
});

test("an unknown suggestion model warns at session start and disables suggestions", async () => {
  for (const model of ["not-a-provider-model", "missing/model"]) {
    let requests = 0;
    const { suggestion, warnings } = makeSuggestion({
      findModel: () => undefined,
      complete: async () => {
        requests++;
        return "next";
      },
    });
    start(suggestion, { enabled: true, model });
    suggestion.agentStart();
    await suggestion.turnEnd(assistantTurn("done"), 0);
    assert.equal(requests, 0);
    assert.deepEqual(warnings, [`Next-step suggestion model "${model}" is not a known provider/model.`]);
  }
});

test("settings applied at runtime turn suggestions on and switch the model", async () => {
  const seen: unknown[] = [];
  const override = { id: "override" };
  const { suggestion } = makeSuggestion({
    findModel: (provider, id) => (provider === "provider" && id === "model" ? override : undefined),
    complete: async ({ model }) => {
      seen.push(model);
      return "next";
    },
  });
  start(suggestion, { enabled: false });
  suggestion.agentStart();
  await suggestion.turnEnd(assistantTurn("done"), 0);
  assert.deepEqual(seen, [], "suggestions started on");

  suggestion.applySettings({ enabled: true, model: "provider/model" });
  suggestion.agentStart();
  await suggestion.turnEnd(assistantTurn("done again"), 0);
  assert.deepEqual(seen, [override]);

  suggestion.applySettings({ enabled: true });
  suggestion.agentStart();
  await suggestion.turnEnd(assistantTurn("done once more"), 0);
  assert.deepEqual(
    seen,
    [override, { id: "session" }],
    "dropping the model setting did not fall back to the session model",
  );
});

test("turning suggestions off discards the ghost and aborts the request", async () => {
  let reply!: (text: string) => void;
  let signal: AbortSignal | undefined;
  const { suggestion, editor } = makeSuggestion({
    complete: ({ signal: requestSignal }) => {
      signal = requestSignal;
      return new Promise<string>((resolve) => (reply = resolve));
    },
  });
  start(suggestion);
  suggestion.agentStart();
  const pending = suggestion.turnEnd(assistantTurn("done"), 0);
  editor.setSuggestion("old ghost");

  suggestion.applySettings({ enabled: false });
  reply("late suggestion");
  await pending;
  assert.equal(signal?.aborted, true);
  assert.equal(editor.getSuggestion(), undefined);

  suggestion.agentStart();
  await suggestion.turnEnd(assistantTurn("done again"), 0);
  assert.equal(editor.getSuggestion(), undefined, "a disabled suggestion still requested");
});

function counting() {
  let requests = 0;
  const made = makeSuggestion({
    complete: async () => {
      requests++;
      return "run the tests";
    },
  });
  start(made.suggestion);
  return { ...made, requests: () => requests };
}

async function run(suggestion: Suggestion, stopReason = "stop"): Promise<void> {
  suggestion.agentStart();
  await suggestion.turnEnd({ role: "assistant", stopReason, content: [{ type: "text", text: "done" }] }, 0);
  await suggestion.agentSettled(false);
}

test("a run that ends in an error asks for nothing, the next good run does", async () => {
  const { suggestion, warnings, requests } = counting();
  await run(suggestion, "error");
  assert.equal(requests(), 0);
  assert.deepEqual(warnings, []);
  await run(suggestion);
  assert.equal(requests(), 1);
});

test("a run cut off at the length limit still asks", async () => {
  const { suggestion, requests } = counting();
  await run(suggestion, "length");
  assert.equal(requests(), 1);
});

test("after ten unused suggestions only every third run asks, and one tab acceptance resets that", async () => {
  const { suggestion, requests } = counting();
  for (let i = 0; i < 10; i++) await run(suggestion);
  assert.equal(requests(), 10);
  for (let i = 0; i < 3; i++) await run(suggestion);
  assert.equal(requests(), 11, "three runs after ten unused suggestions ask once");
  for (let i = 0; i < 3; i++) await run(suggestion);
  assert.equal(requests(), 12);
  suggestion.accepted();
  for (let i = 0; i < 3; i++) await run(suggestion);
  assert.equal(requests(), 15, "an accepted suggestion brings back one request per run");
});

test("reasoning models ask for their lowest thinking level, others for none", () => {
  const lowOnly = {
    reasoning: true,
    thinkingLevelMap: { off: null, minimal: null, medium: null, low: "low", high: "high" },
  };
  assert.equal(suggestReasoning(lowOnly as never), "low");
  assert.equal(suggestReasoning({ reasoning: true } as never), "minimal");
  assert.equal(suggestReasoning({ reasoning: false } as never), undefined);
});

test("a request that runs past the timeout warns once and stops asking", async () => {
  // Rejecting on abort, and resolving with no text the way an aborted stream ends, are both a timeout.
  const endings = [
    (_resolve: (text: string) => void, reject: (error: Error) => void) => reject(new Error("aborted")),
    (resolve: (text: string) => void) => resolve(""),
  ];
  for (const end of endings) {
    let requests = 0;
    const { suggestion, warnings } = makeSuggestion({
      timeoutMs: 20,
      complete: ({ signal }) => {
        requests++;
        return new Promise((resolve, reject) => signal.addEventListener("abort", () => end(resolve, reject)));
      },
    });
    start(suggestion);
    await run(suggestion);
    assert.deepEqual(warnings, ["Next-step suggestion failed: timed out after 0.02 s"]);
    await run(suggestion);
    assert.equal(requests, 1);
  }
});

test("text before the cursor narrows the room for the rest of the suggestion", () => {
  const row = withGhostSuggestion(
    `运行${GHOST_CLEAR} ${GHOST_RESTORE}${" ".repeat(20)}`,
    "测试并提交".repeat(5),
    (t) => t,
    24,
  );
  assert.equal(visibleWidth(row), 24);
  assert.ok(row.startsWith(`运行${GHOST_CLEAR} ${GHOST_RESTORE}测试`));
});
