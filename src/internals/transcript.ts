import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { type Component, ScrollView, type TUI } from "@earendil-works/pi-tui";

/**
 * Pi internals this module relies on, verified against Pi 1.4.0:
 *
 * - The fullscreen TUI exposes `viewportTop`, `scrollBy(lines)` and `hasActiveSelection()`; the TUI type does
 *   not declare them. A selection is copied as drawn on screen, overlays included.
 * - The root's first child is the document, and the document is [header, loadedResources, chat].
 * - The private `layoutRoot` has the primary `ScrollView` around the document among its children. The
 *   document renders at that view's content width, a column narrower than the terminal while the scrollbar
 *   is always shown, and the view's `viewportHeight` is the number of transcript rows on screen.
 * - User prompts are `UserMessageComponent` children of the chat; the prompt text is the private `text` field.
 *
 * Every shape is checked at runtime. A mismatch returns an `Error` so the caller can disable the feature.
 */
export type ScrollableTui = TUI & {
  readonly viewportTop: number;
  scrollBy(lines: number): void;
  hasActiveSelection(): boolean;
};

export interface Prompt {
  row: number;
  text: string;
}

function isComponent(value: unknown): value is Component {
  return typeof value === "object" && value !== null && typeof (value as Component).render === "function";
}

function childrenOf(value: unknown): Component[] | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const children = (value as { children?: unknown }).children;
  if (!Array.isArray(children) || !children.every(isComponent)) return undefined;
  return children as Component[];
}

export function asScrollable(tui: TUI): ScrollableTui | undefined {
  const candidate = tui as Partial<ScrollableTui>;
  return typeof candidate.viewportTop === "number" &&
    typeof candidate.scrollBy === "function" &&
    typeof candidate.hasActiveSelection === "function"
    ? (candidate as ScrollableTui)
    : undefined;
}

function transcriptView(tui: TUI): ScrollView | Error {
  const layoutRoot = (tui as unknown as { layoutRoot?: unknown }).layoutRoot;
  const view = childrenOf(layoutRoot)?.find((child) => child instanceof ScrollView && child.primary);
  return view instanceof ScrollView ? view : new Error("TUI layout has no transcript scroll view");
}

/** Content width of the transcript scroll view: the terminal width minus Pi's scrollbar column when it is shown. */
export function transcriptWidth(tui: TUI): number | Error {
  const view = transcriptView(tui);
  return view instanceof Error ? view : view.getContentWidth(tui.terminal.columns);
}

export function collectPrompts(tui: TUI): { prompts: Prompt[]; total: number } | Error {
  const width = transcriptWidth(tui);
  if (width instanceof Error) return width;
  const root = childrenOf(tui);
  if (!root) return new Error("TUI root has no component children");
  const document = childrenOf(root[0]);
  if (!document) return new Error("document has no component children");
  if (document.length < 3) {
    return new Error(`document has ${document.length} children, expected [header, loadedResources, chat]`);
  }
  const [header, resources, chat] = document;
  const chatChildren = childrenOf(chat);
  if (!chatChildren) return new Error("chat has no component children");

  let row = header.render(width).length + resources.render(width).length;
  const prompts: Prompt[] = [];
  for (const child of chatChildren) {
    if (child instanceof UserMessageComponent) {
      const text = (child as unknown as { text?: unknown }).text;
      if (typeof text !== "string") return new Error("user message has no text");
      prompts.push({ row, text });
    }
    row += child.render(width).length;
  }
  return { prompts, total: row };
}

/** Transcript rows on screen, as laid out for the frame being drawn. */
export function transcriptViewportHeight(tui: TUI): number | Error {
  const view = transcriptView(tui);
  return view instanceof Error ? view : Math.max(1, view.viewportHeight);
}

export function jumpTo(tui: ScrollableTui, row: number): void {
  tui.scrollBy(row - tui.viewportTop);
}
