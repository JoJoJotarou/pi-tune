import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssistantMessageComponent,
  initTheme,
  type MarkdownTransformContext,
  type MessageEndEvent,
  type MessageUpdateEvent,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { createThinkingSession, type ThinkingContext, type ThinkingHost, type ThinkingSession } from "./session.ts";

// The component styles its rows through pi's global theme.
initTheme("dark");

interface Harness {
  session: ThinkingSession;
  ctx: ThinkingContext;
  /** The component pi draws for the newest assistant message. */
  message: AssistantMessageComponent;
  /** What the reader sees for that message, thinking fold included. */
  rows(): string[];
  /** Draw the message into the transcript, as a run does. */
  draw(): void;
  /** Hand pi's next frame a tree; defaults to the transcript the session last saw. */
  bind(tree?: TUI): void;
  labels: string[];
  warnings: string[];
  now(ms: number): void;
}

function harness(): Harness {
  let nowMs = 1_000;
  const labels: string[] = [];
  const warnings: string[] = [];
  const message = new AssistantMessageComponent({
    role: "assistant",
    content: [
      { type: "thinking", thinking: "plan the answer" },
      { type: "text", text: "done" },
    ],
  } as never);
  // A fresh session starts empty; a rebuilt one already holds its messages.
  const transcript = { children: [] as unknown[] } as unknown as TUI;
  let widget: ((tui: TUI, theme: unknown) => unknown) | undefined;
  const ctx: ThinkingContext = {
    mode: "tui",
    ui: {
      setHiddenThinkingLabel: (label) => labels.push(label ?? ""),
      setWidget: (_key, content) => {
        if (typeof content !== "function") return;
        widget = content as unknown as (tui: TUI, theme: unknown) => unknown;
      },
      notify: (text, level) => warnings.push(`${level}: ${text}`),
    },
  };
  const host: ThinkingHost = { now: () => nowMs, colorEnabled: () => false };
  return {
    session: createThinkingSession(host),
    ctx,
    message,
    rows: () =>
      message
        .render(80)
        .map((row) => stripTerminalSequences(row).trimEnd())
        .filter((row) => row.trim() !== "")
        .map((row) => row.trimStart()),
    draw: () => {
      (transcript as unknown as { children: unknown[] }).children.push(message);
    },
    bind: (tree = transcript) => widget?.(tree, testTheme()),
    labels,
    warnings,
    now: (ms) => {
      nowMs = ms;
    },
  };
}

/** Start a session and draw its first frame: an empty transcript, before any run. */
function start(h: Harness): void {
  h.session.start(h.ctx);
  h.bind();
}

function thinkingEvent(
  type: "thinking_start" | "thinking_end" | "thinking_delta" | "text_start",
  contentIndex = 0,
  content?: string,
): MessageUpdateEvent {
  return { type: "message_update", assistantMessageEvent: { type, contentIndex, content } } as MessageUpdateEvent;
}

function assistantEnd(): MessageEndEvent {
  return { type: "message_end", message: { role: "assistant", content: [] } } as unknown as MessageEndEvent;
}

function thinkingContext(width = 80): MarkdownTransformContext {
  return { messageType: "assistant-thinking", isStreaming: false, availableWidth: width };
}

function transform(session: ThinkingSession, markdown: string): string {
  return stripTerminalSequences(session.transformThinking(markdown, thinkingContext()));
}

test("a streamed block rolls in one row, then folds to its measured time", () => {
  const h = harness();
  start(h);
  h.draw();
  h.session.messageUpdate(thinkingEvent("thinking_start"));
  assert.match(transform(h.session, "plan the answer"), /^◆ Thinking · /);

  h.now(1_400);
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "plan the answer"));

  assert.equal(h.rows()[0], "◆ Thought for 0.4s");
  assert.ok(!h.rows().includes("plan the answer"), `the folded block hides its text:\n${h.rows().join("\n")}`);
});

test("a rebuilt transcript is folded without a time", () => {
  const h = harness();
  h.draw(); // a reload or a resumed session draws its messages before this session starts
  start(h);

  assert.equal(h.rows()[0], "◆ Thought");
  assert.ok(!h.rows().includes("plan the answer"), `history folds:\n${h.rows().join("\n")}`);
});

test("an opened block is pi's own markdown, untouched", () => {
  const h = harness();
  start(h);
  h.draw();
  h.session.messageUpdate(thinkingEvent("thinking_start"));
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "plan the answer"));

  const markdown = "## plan\n\n- step `one`\n- step two";
  assert.equal(transform(h.session, markdown), markdown);
});

test("two thinking blocks in one message fold to their total", () => {
  const h = harness();
  start(h);
  h.draw();
  h.session.messageUpdate(thinkingEvent("thinking_start", 0));
  h.now(1_500);
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "first"));
  h.now(2_000);
  h.session.messageUpdate(thinkingEvent("thinking_start", 1));
  h.now(3_000);
  h.session.messageUpdate(thinkingEvent("thinking_end", 1, "second"));

  assert.equal(h.rows()[0], "◆ Thought for 1.5s");
});

test("a block that never ends claims no time", () => {
  const h = harness();
  start(h);
  h.draw();
  h.session.messageUpdate(thinkingEvent("thinking_start"));
  h.now(4_000);
  h.session.messageEnd(assistantEnd());

  assert.equal(h.rows()[0], "◆ Thought");
  assert.doesNotMatch(h.rows()[0], /for/);
});

test("one unmeasured block leaves the whole message unmeasured", () => {
  const h = harness();
  start(h);
  h.draw();
  h.session.messageUpdate(thinkingEvent("thinking_start", 0));
  h.now(1_500);
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "measured"));
  h.session.messageUpdate(thinkingEvent("thinking_start", 1));
  h.session.messageEnd(assistantEnd());

  assert.equal(h.rows()[0], "◆ Thought");
});

test("a clock that goes backwards claims no time", () => {
  const h = harness();
  start(h);
  h.draw();
  h.session.messageUpdate(thinkingEvent("thinking_start"));
  h.now(500);
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "plan"));

  assert.equal(h.rows()[0], "◆ Thought");
});

test("start labels history and resets the message being streamed", () => {
  const h = harness();
  start(h);
  h.draw();
  h.session.messageUpdate(thinkingEvent("thinking_start"));
  h.now(2_500);
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "stale"));

  h.session.start(h.ctx);
  assert.deepEqual(h.labels, ["◆ Thinking · click to expand", "◆ Thinking · click to expand"]);

  h.bind();
  assert.equal(h.rows()[0], "◆ Thought", "the rebuilt transcript is folded again");

  h.session.messageUpdate(thinkingEvent("thinking_start"));
  h.now(3_000);
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "fresh"));
  assert.equal(h.rows()[0], "◆ Thought for 0.5s");
});

test("a frame drawn before the message exists still folds later runs", () => {
  const h = harness();
  start(h);
  h.session.messageUpdate(thinkingEvent("thinking_start"));
  h.now(1_500);
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "plan"));
  assert.deepEqual(h.warnings, [], "a transcript without the message yet is not breakage");

  h.session.messageEnd(assistantEnd());
  h.draw();
  h.session.messageUpdate(thinkingEvent("thinking_start"));
  h.now(2_000);
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "plan"));
  assert.equal(h.rows()[0], "◆ Thought for 0.5s");
});

test("a moved transcript shape warns once and stops folding", () => {
  const h = harness();
  const broken = { children: [h.message, { not: "a component" }] } as unknown as TUI;
  h.session.start(h.ctx);
  h.bind(broken);

  h.session.messageUpdate(thinkingEvent("thinking_start"));
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "plan"));
  h.session.messageUpdate(thinkingEvent("thinking_start"));
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "plan again"));

  assert.equal(h.warnings.length, 1, h.warnings.join("\n"));
  assert.match(h.warnings[0], /fold disabled/);
  assert.ok(h.rows().includes("plan the answer"), `the block stays as pi drew it:\n${h.rows().join("\n")}`);
});

test("other markdown passes through untouched", () => {
  const h = harness();
  const context: MarkdownTransformContext = { messageType: "assistant", isStreaming: false, availableWidth: 80 };
  assert.equal(h.session.transformThinking("# plain", context), "# plain");
});

test("print mode never touches the TUI", () => {
  const h = harness();
  h.session.start({ ...h.ctx, mode: "print" });
  h.session.messageUpdate(thinkingEvent("thinking_start"));
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "plan"));

  assert.deepEqual(h.labels, []);
  assert.deepEqual(h.warnings, []);
});
