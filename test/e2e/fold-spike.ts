/**
 * Spike extension: fold a thinking block as soon as it settles, without a markdown transformer.
 *
 * It answers one question for the thinking redesign: does a fold applied with the public
 * `AssistantMessageComponent` methods survive a terminal resize, or does Pi rebuild the component and drop it.
 *
 * The TUI only reaches an extension through a widget factory; the transcript components are found by walking
 * its children. Only `AssistantMessageComponent`'s public API is used: `setHideThinkingBlock`,
 * `setHiddenThinkingLabel`, `invalidate`.
 */
import { AssistantMessageComponent, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";

/** The text the folded row carries; the e2e test asserts on it. */
export const FOLD_LABEL = "◆ Spike fold";

function isComponent(value: unknown): value is Component {
  return typeof value === "object" && value !== null && typeof (value as Component).render === "function";
}

function assistantMessages(root: Component): AssistantMessageComponent[] {
  const found: AssistantMessageComponent[] = [];
  const seen = new Set<Component>();
  const walk = (component: Component): void => {
    if (seen.has(component)) return;
    seen.add(component);
    if (component instanceof AssistantMessageComponent) found.push(component);
    const children = (component as { children?: unknown }).children;
    if (!Array.isArray(children)) return;
    for (const child of children) if (isComponent(child)) walk(child);
  };
  walk(root);
  return found;
}

export default (pi: ExtensionAPI) => {
  let tui: TUI | undefined;

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget("fold-spike", (widgetTui) => {
      tui = widgetTui;
      return { render: () => [], invalidate() {} };
    });
  });

  pi.on("message_update", (event, ctx) => {
    if (event.assistantMessageEvent?.type !== "thinking_end") return;
    const screen = tui;
    const last = screen ? assistantMessages(screen).at(-1) : undefined;
    if (!screen || !last) {
      ctx.ui.notify("fold spike: no assistant message component", "warning");
      return;
    }
    last.setHideThinkingBlock(true);
    last.setHiddenThinkingLabel(FOLD_LABEL);
    last.invalidate();
    screen.requestRender(true);
  });
};
