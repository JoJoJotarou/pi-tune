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
 * - That view's private `contentHeight` is the document's height from the layout pass of the frame being drawn;
 *   overlays' `visible` gates run after that pass.
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

/**
 * Prompts move only when the width changes, a child's height changes (which changes the content height), or the chat
 * gains or loses children; a rebuilt chat also ends in a new child. Two height changes that cancel out within one
 * frame go unnoticed until the next change.
 */
interface TranscriptKey {
  width: number;
  contentHeight: number;
  count: number;
  last: Component | undefined;
}

export interface Transcript {
  prompts: Prompt[];
  total: number;
  key: TranscriptKey;
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

function sameKey(a: TranscriptKey, b: TranscriptKey): boolean {
  return a.width === b.width && a.contentHeight === b.contentHeight && a.count === b.count && a.last === b.last;
}

/** Walking the chat renders every child, so pass the previous result to get it back while its key still holds. */
export function collectPrompts(tui: TUI, previous?: Transcript): Transcript | Error {
  const view = transcriptView(tui);
  if (view instanceof Error) return view;
  const width = view.getContentWidth(tui.terminal.columns);
  const contentHeight = (view as unknown as { contentHeight?: unknown }).contentHeight;
  if (typeof contentHeight !== "number") return new Error("transcript scroll view has no content height");
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
  const key = { width, contentHeight, count: chatChildren.length, last: chatChildren.at(-1) };
  if (previous && sameKey(previous.key, key)) return previous;

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
  return { prompts, total: row, key };
}

/** Transcript rows on screen, as laid out for the frame being drawn. */
export function transcriptViewportHeight(tui: TUI): number | Error {
  const view = transcriptView(tui);
  return view instanceof Error ? view : Math.max(1, view.viewportHeight);
}

export function jumpTo(tui: ScrollableTui, row: number): void {
  tui.scrollBy(row - tui.viewportTop);
}
