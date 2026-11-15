import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageComponent, initTheme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { assistantMessages, type DrawnMessage, drawnMessage, newestAssistantMessage } from "./transcript-components.ts";

initTheme("dark", false);

const MESSAGE_TIMESTAMP = 1_700_000_000_000;

function message(stopReason: "stop" | "pending" = "stop"): AssistantMessageComponent {
  return new AssistantMessageComponent({
    role: "assistant",
    timestamp: MESSAGE_TIMESTAMP,
    stopReason,
    content: [],
  } as never);
}

function container(children: unknown[]): Component {
  return { children, render: () => [], invalidate() {} } as unknown as Component;
}

/** The TUI is only walked through `children`; the walker reads nothing else. */
function tree(children: unknown[]): TUI {
  return { children } as unknown as TUI;
}

test("finds the assistant messages in a transcript, nested ones included", () => {
  const first = message();
  const second = message();
  const found = assistantMessages(tree([container([first, { render: () => [], invalidate() {} }]), second]));
  assert.deepEqual(found, [first, second]);
});

test("children that are not an array stop the walk with an error", () => {
  const notAnArray = { children: "not an array", render: () => [], invalidate() {} };
  const result = assistantMessages(tree([notAnArray, message()]));
  assert.ok(result instanceof Error);
  assert.equal(result.message, "a transcript component has children that are not an array");
});

test("a child that is not a component stops the walk with an error", () => {
  const result = assistantMessages(tree([container([{ notAComponent: true }])]));
  assert.ok(result instanceof Error);
  assert.equal(result.message, "the transcript holds a child that is not a component");
});

test("a cycle is visited once and the walk terminates", () => {
  const loop = container([]);
  (loop as unknown as { children: unknown[] }).children = [loop];
  const nested = container([container([loop])]);
  assert.deepEqual(assistantMessages(tree([nested])), []);
});

test("the newest message is the last one in the walk", () => {
  const first = message();
  const second = message();
  assert.equal(newestAssistantMessage(tree([first, container([second])])), second);
  assert.equal(newestAssistantMessage(tree([])), undefined);
});

test("the drawn message is its timestamp and whether it is still pending", () => {
  assert.deepEqual(drawnMessage(message("pending")), {
    timestamp: MESSAGE_TIMESTAMP,
    pending: true,
  } satisfies DrawnMessage);
  assert.deepEqual(drawnMessage(message("stop")), { timestamp: MESSAGE_TIMESTAMP, pending: false });
});

test("a component without a message draws nothing yet", () => {
  assert.equal(drawnMessage(new AssistantMessageComponent()), undefined);
});

test("a drawn message that is not an object is an error", () => {
  for (const lastMessage of ["text", 42, null]) {
    const component = { lastMessage } as unknown as AssistantMessageComponent;
    const result = drawnMessage(component);
    assert.ok(result instanceof Error);
    assert.equal(result.message, "the drawn assistant message is not an object");
  }
});

test("a drawn message without a numeric timestamp is an error", () => {
  for (const timestamp of [undefined, "1700000000000"]) {
    const component = { lastMessage: { timestamp, stopReason: "stop" } } as unknown as AssistantMessageComponent;
    const result = drawnMessage(component);
    assert.ok(result instanceof Error);
    assert.equal(result.message, "the drawn assistant message has no timestamp");
  }
});
