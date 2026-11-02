import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { type FlipState, startFlip, updateFlip } from "../navigation/flip.ts";

/**
 * Pi internals this module relies on, verified against Pi 1.4.0:
 *
 * - The fullscreen TUI exposes `viewportTop`, `scrollBy(lines)` and `scrollToBottom()`; the TUI type does not
 *   declare them.
 * - The root is mounted as [document, pending, status, widgetsAbove, editor, widgetsBelow, footer], and
 *   the document is [header, loadedResources, chat]. A child appended after the chat does not disturb Pi's own
 *   indexes.
 * - User prompts are `UserMessageComponent` children of the chat; the prompt text is the private `text` field.
 *
 * Every shape is checked at runtime. A mismatch returns an `Error` so the caller can disable the feature.
 */
export type ScrollableTui = TUI & { readonly viewportTop: number; scrollBy(lines: number): void };

export type FlippableTui = ScrollableTui & { scrollToBottom(): void };

export interface Prompt {
  row: number;
  text: string;
}

type WithChildren = Component & { children: Component[] };

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
  return typeof candidate.viewportTop === "number" && typeof candidate.scrollBy === "function"
    ? (candidate as ScrollableTui)
    : undefined;
}

export function asFlippable(tui: TUI): FlippableTui | undefined {
  const scrollable = asScrollable(tui);
  if (!scrollable) return undefined;
  const candidate = scrollable as ScrollableTui & { scrollToBottom?: unknown };
  return typeof candidate.scrollToBottom === "function" ? (candidate as FlippableTui) : undefined;
}

/** Append a child after [header, loadedResources, chat] so Pi's own indexes stay intact. */
export function appendToDocument(tui: TUI, child: Component): Error | undefined {
  const root = childrenOf(tui);
  if (!root) return new Error("TUI root has no component children");
  const document = root[0] as Component & { addChild?: unknown };
  const documentChildren = childrenOf(document);
  if (!documentChildren) return new Error("document has no component children");
  if (documentChildren.length < 3) {
    return new Error(`document has ${documentChildren.length} children, expected [header, loadedResources, chat]`);
  }
  if (!childrenOf(documentChildren[2])) return new Error("chat has no component children");
  if (typeof document.addChild !== "function") return new Error("document has no addChild");
  (document.addChild as (component: Component) => void).call(document, child);
  return undefined;
}

export function collectPrompts(tui: TUI, width: number): { prompts: Prompt[]; total: number } | Error {
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

export function transcriptViewportHeight(tui: TUI, width: number): number {
  const dock = (tui as unknown as WithChildren).children
    .slice(1)
    .reduce((sum, child) => sum + child.render(width).length, 0);
  return Math.max(1, tui.terminal.rows - dock);
}

export function jumpTo(tui: ScrollableTui, row: number): void {
  tui.scrollBy(row - tui.viewportTop);
}

/**
 * The spacer appended after the chat. While a flip is active it renders blank lines that keep the document tall
 * enough for the viewport to reach the new prompt row, and it shrinks as the answer grows.
 */
export class FlipSpacer implements Component {
  private readonly tui: FlippableTui;
  private readonly onError: (error: Error) => void;
  private padding = 0;
  private promptCount = 0;
  private flip: FlipState | undefined;
  private landed = false;
  private disabled = false;

  constructor(tui: FlippableTui, onError: (error: Error) => void) {
    this.tui = tui;
    this.onError = onError;
  }

  render(width: number): string[] {
    if (this.disabled) return [];
    const transcript = collectPrompts(this.tui, width);
    if (transcript instanceof Error) {
      this.disabled = true;
      this.padding = 0;
      this.flip = undefined;
      this.onError(transcript);
      return [];
    }
    const prompts = transcript.prompts;
    const last = prompts[prompts.length - 1];

    if (prompts.length < this.promptCount) {
      this.promptCount = prompts.length;
      this.flip = undefined;
      this.landed = false;
    }
    if (last && prompts.length > this.promptCount) {
      this.promptCount = prompts.length;
      this.flip = startFlip(last.row, transcript.total, transcriptViewportHeight(this.tui, width));
      this.landed = false;
    }

    const flip = this.flip;
    if (!flip) {
      this.padding = 0;
      return [];
    }
    if (this.landed && this.tui.viewportTop !== flip.promptRow) {
      this.flip = undefined;
      this.padding = 0;
      this.landed = false;
      return [];
    }
    const next = updateFlip(flip, transcript.total);
    if (next.done) {
      this.flip = undefined;
      this.padding = 0;
      this.landed = false;
      queueMicrotask(() => this.tui.scrollToBottom());
      return [];
    }
    this.flip = next;
    this.padding = next.padding;
    queueMicrotask(() => {
      jumpTo(this.tui, flip.promptRow);
      this.landed = this.tui.viewportTop === flip.promptRow;
    });
    return Array.from({ length: this.padding }, () => "");
  }

  invalidate(): void {}
}
