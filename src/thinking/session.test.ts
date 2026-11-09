import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AssistantMessageComponent,
  initTheme,
  type MarkdownTransformContext,
  type MessageEndEvent,
  type MessageStartEvent,
  type MessageUpdateEvent,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { createThinkingSession, type ThinkingContext, type ThinkingHost, type ThinkingSession } from "./session.ts";

// The component styles its rows through pi's global theme.
initTheme("dark");

/** The timestamp pi stamps on the drawn message; a recorded thinking time is keyed by it. */
const MESSAGE_TIMESTAMP = 1_700_000_000_000;

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
  /** Draw one frame, which is when the session gets to fold what is already in the transcript. */
  frame(): void;
  labels: string[];
  warnings: string[];
  /** Custom session entries the session asked pi to keep. */
  appended: { customType: string; data: unknown }[];
  /** Session entries pi would replay at start. */
  entries: SessionEntry[];
  /** Frames the session asked pi to draw. */
  readonly repaints: number;
  now(ms: number): void;
}

function harness(options: { pending?: boolean } = {}): Harness {
  let nowMs = 1_000;
  const labels: string[] = [];
  const warnings: string[] = [];
  const message = new AssistantMessageComponent({
    role: "assistant",
    timestamp: MESSAGE_TIMESTAMP,
    stopReason: options.pending ? "pending" : "stop",
    content: [
      { type: "thinking", thinking: "plan the answer" },
      { type: "text", text: "done" },
    ],
  } as never);
  let repaints = 0;
  // A fresh session starts empty; a rebuilt one already holds its messages.
  const transcript = {
    children: [] as unknown[],
    requestRender: () => {
      repaints++;
    },
  } as unknown as TUI;
  let widget: ((tui: TUI, theme: unknown) => { render(): string[] }) | undefined;
  let drawn: { render(): string[] } | undefined;
  const appended: { customType: string; data: unknown }[] = [];
  const entries: SessionEntry[] = [];
  const ctx: ThinkingContext = {
    mode: "tui",
    ui: {
      setHiddenThinkingLabel: (label) => labels.push(label ?? ""),
      setWidget: (_key, content) => {
        if (typeof content !== "function") return;
        widget = content as unknown as (tui: TUI, theme: unknown) => { render(): string[] };
      },
      notify: (text, level) => warnings.push(`${level}: ${text}`),
    },
    sessionManager: { getEntries: () => entries },
  };
  const host: ThinkingHost = {
    now: () => nowMs,
    colorEnabled: () => false,
    appendEntry: (customType, data) => appended.push({ customType, data }),
  };
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
    bind: (tree = transcript) => {
      drawn = widget?.(tree, testTheme());
    },
    frame: () => {
      drawn?.render();
    },
    labels,
    warnings,
    appended,
    entries,
    get repaints() {
      return repaints;
    },
    now: (ms) => {
      nowMs = ms;
    },
  };
}

/** Start a session and draw its first frame: an empty transcript, before any run. */
function start(h: Harness): void {
  h.session.start(h.ctx);
  h.bind();
  h.frame();
}

function thinkingEvent(
  type: "thinking_start" | "thinking_end" | "thinking_delta" | "text_start",
  contentIndex = 0,
  content?: string,
): MessageUpdateEvent {
  return { type: "message_update", assistantMessageEvent: { type, contentIndex, content } } as MessageUpdateEvent;
}

function assistantEnd(): MessageEndEvent {
  return {
    type: "message_end",
    message: { role: "assistant", timestamp: MESSAGE_TIMESTAMP, content: [] },
  } as unknown as MessageEndEvent;
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

test("a measured run is written into the session", () => {
  const h = harness();
  start(h);
  h.draw();
  h.session.messageUpdate(thinkingEvent("thinking_start"));
  h.now(1_400);
  h.session.messageUpdate(thinkingEvent("thinking_end", 0, "plan the answer"));
  h.session.messageEnd(assistantEnd());

  assert.deepEqual(h.appended, [{ customType: "pi-tune-thinking", data: { timestamp: MESSAGE_TIMESTAMP, ms: 400 } }]);
});

test("a message without thinking records nothing", () => {
  const h = harness();
  start(h);
  h.draw();
  h.session.messageEnd(assistantEnd());

  assert.deepEqual(h.appended, []);
});

test("a recorded time comes back on a rebuilt transcript", () => {
  const h = harness();
  h.entries.push({
    type: "custom",
    customType: "pi-tune-thinking",
    data: { timestamp: MESSAGE_TIMESTAMP, ms: 3_400 },
  } as unknown as SessionEntry);
  h.draw();
  start(h);

  assert.equal(h.rows()[0], "◆ Thought for 3.4s");
});

test("a time recorded for another message leaves the label without one", () => {
  const h = harness();
  h.entries.push({
    type: "custom",
    customType: "pi-tune-thinking",
    data: { timestamp: MESSAGE_TIMESTAMP + 1, ms: 3_400 },
  } as unknown as SessionEntry);
  h.draw();
  start(h);

  assert.equal(h.rows()[0], "◆ Thought");
});

test("a run in progress leaves the drawn history alone", () => {
  const h = harness();
  start(h);
  h.session.messageStart({ type: "message_start", message: { role: "assistant" } } as MessageStartEvent);
  h.draw();
  h.frame();
  assert.ok(h.rows().includes("plan the answer"), `no fold while the run streams:\n${h.rows().join("\n")}`);

  h.session.messageEnd(assistantEnd());
  h.frame();
  assert.equal(h.rows()[0], "◆ Thought", "the settled message folds once the run ends");
});

test("a message still streaming is not folded", () => {
  const h = harness({ pending: true });
  h.draw();
  start(h);

  assert.ok(h.rows().includes("plan the answer"), `a pending message is left alone:\n${h.rows().join("\n")}`);
});

test("folding the drawn history asks for one more frame", () => {
  const h = harness();
  h.draw();
  start(h);

  assert.ok(h.repaints >= 1, "the frame that folded already drew the unfolded rows");
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
  h.frame();
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
