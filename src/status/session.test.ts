import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { MessageUpdateEvent } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { createStatusSession, type StatusContext, type StatusHost, type StatusSession } from "./session.ts";

const theme = testTheme("dark");

function progress(type: AssistantMessageEvent["type"]): MessageUpdateEvent {
  return { type: "message_update", assistantMessageEvent: { type } } as MessageUpdateEvent;
}

interface Harness {
  session: StatusSession;
  messages: (string | undefined)[];
  titles: string[];
  worked: number[];
  refresh: { callback: () => void; cancelled: boolean };
  now(ms: number): void;
  ctx(mode?: "tui" | "rpc"): StatusContext;
}

function harness(): Harness {
  const messages: (string | undefined)[] = [];
  const titles: string[] = [];
  const worked: number[] = [];
  const refresh = { callback: (): void => {}, cancelled: false };
  let nowMs = 1_000;
  const ctx = (mode: "tui" | "rpc" = "tui"): StatusContext => ({
    mode,
    cwd: "/tmp/myproj",
    ui: {
      theme,
      setWorkingMessage: (message) => messages.push(message),
      setTitle: (title) => titles.push(title),
    },
  });
  const host: StatusHost = {
    now: () => nowMs,
    interruptKey: () => "esc",
    sessionName: () => undefined,
    terminalColumns: () => 100,
    every: (callback) => {
      refresh.callback = callback;
      return () => {
        refresh.cancelled = true;
      };
    },
    appendWorked: (ms) => worked.push(ms),
  };
  return {
    session: createStatusSession(host),
    messages,
    titles,
    worked,
    refresh,
    now: (ms) => {
      nowMs = ms;
    },
    ctx,
  };
}

function lastMessage(h: Harness): string {
  return stripTerminalSequences(h.messages.at(-1) ?? "");
}

test("the working message follows the run's phases", () => {
  const h = harness();
  const ctx = h.ctx();
  h.session.start(ctx);
  h.messages.length = 0;

  h.session.agentStart(ctx);
  assert.match(lastMessage(h), /Working/);

  h.session.messageUpdate(progress("thinking_delta"));
  assert.match(lastMessage(h), /Thinking/);

  h.session.messageUpdate(progress("text_delta"));
  assert.match(lastMessage(h), /Responding/);

  h.session.toolExecutionStart("call-1");
  assert.match(lastMessage(h), /Working/);
});

test("a settled run clears the message and appends the worked entry", () => {
  const h = harness();
  const ctx = h.ctx();
  h.session.start(ctx);
  h.session.agentStart(ctx);
  h.messages.length = 0;

  h.now(4_000);
  h.session.agentSettled(false, ctx);
  assert.equal(h.messages.at(-1), undefined);
  assert.deepEqual(h.worked, [3_000]);
  assert.equal(h.refresh.cancelled, true);
});

test("the refresh timer repaints the elapsed time", () => {
  const h = harness();
  const ctx = h.ctx();
  h.session.start(ctx);
  h.session.agentStart(ctx);
  h.messages.length = 0;

  h.now(3_500);
  h.refresh.callback();
  assert.match(lastMessage(h), /2\.5s/);
});

test("shutdown clears the message and silences late settles", () => {
  const h = harness();
  const ctx = h.ctx();
  h.session.start(ctx);
  h.session.agentStart(ctx);
  h.messages.length = 0;

  h.session.shutdown(ctx);
  assert.equal(h.messages.at(-1), undefined);
  assert.equal(h.refresh.cancelled, true);

  h.session.agentSettled(false, ctx);
  assert.deepEqual(h.worked, []);
});
