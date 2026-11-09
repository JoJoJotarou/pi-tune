import { AssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

/**
 * Pi internals this module relies on, verified against Pi 1.4.0:
 *
 * - `AssistantMessageComponent` draws one assistant message, thinking blocks included, and is a `Container`, so it
 *   is found by walking `children` from the TUI down. Every container in the tree exposes `children: Component[]`.
 * - The transcript keeps one instance per message across a relayout, so state applied to it survives a resize.
 * - `setHideThinkingBlock`, `setHiddenThinkingLabel` and `invalidate` are its public methods. Both settings live on
 *   the component, so the label is one string per message: every thinking block of a message folds to the same text.
 *
 * A child that is not a component means the shape moved; that returns an `Error` so the caller can drop the fold.
 * No assistant message drawn yet is `undefined`, which the caller skips. `assistantMessageTimestamp` reads the
 * private `lastMessage` for the same reason: matching a measured run back to its message needs that key.
 */
export function assistantMessages(tui: TUI): AssistantMessageComponent[] | Error {
  const seen = new Set<unknown>();
  const found: AssistantMessageComponent[] = [];
  let failure: Error | undefined;

  const visit = (component: Component): void => {
    if (failure !== undefined || seen.has(component)) return;
    seen.add(component);
    if (component instanceof AssistantMessageComponent) found.push(component);
    const children = (component as { children?: unknown }).children;
    if (children === undefined) return;
    if (!Array.isArray(children)) {
      failure = new Error("a transcript component has children that are not an array");
      return;
    }
    for (const child of children) {
      if (!isComponent(child)) {
        failure = new Error("the transcript holds a child that is not a component");
        return;
      }
      visit(child);
    }
  };

  visit(tui);
  return failure ?? found;
}

/** The timestamp Pi stamped on the message this component draws; `undefined` until a message is attached. */
export function assistantMessageTimestamp(component: AssistantMessageComponent): number | undefined | Error {
  const lastMessage = (component as unknown as { lastMessage?: unknown }).lastMessage;
  if (lastMessage === undefined) return undefined;
  if (typeof lastMessage !== "object" || lastMessage === null) {
    return new Error("the drawn assistant message is not an object");
  }
  const timestamp = (lastMessage as { timestamp?: unknown }).timestamp;
  return typeof timestamp === "number" ? timestamp : new Error("the drawn assistant message has no timestamp");
}

/** The message being drawn last, which is the one a stream appends to. */
export function newestAssistantMessage(tui: TUI): AssistantMessageComponent | undefined | Error {
  const messages = assistantMessages(tui);
  return messages instanceof Error ? messages : messages.at(-1);
}

function isComponent(value: unknown): value is Component {
  return typeof value === "object" && value !== null && typeof (value as Component).render === "function";
}
