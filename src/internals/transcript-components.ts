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
 * No assistant message drawn yet is `undefined`, which the caller skips.
 */
export function newestAssistantMessage(tui: TUI): AssistantMessageComponent | undefined | Error {
  const seen = new Set<unknown>();
  let newest: AssistantMessageComponent | undefined;
  let failure: Error | undefined;

  const visit = (component: Component): void => {
    if (failure !== undefined || seen.has(component)) return;
    seen.add(component);
    if (component instanceof AssistantMessageComponent) newest = component;
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
  return failure ?? newest;
}

function isComponent(value: unknown): value is Component {
  return typeof value === "object" && value !== null && typeof (value as Component).render === "function";
}
