import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type OverlayOptions,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import {
  collectPrompts,
  jumpTo,
  type Prompt,
  type ScrollableTui,
  transcriptViewportHeight,
  transcriptWidth,
} from "../internals/transcript.ts";
import { frame } from "../shared/frame.ts";

/** Columns reserved for the rail; it covers Pi's scrollbar column and the right padding. */
export const RAIL_WIDTH = 2;
/**
 * Columns of the transcript the rail covers: its own two, less the scrollbar column the transcript never draws into.
 */
export function railOverlap(terminalWidth: number, contentWidth: number): number {
  return Math.max(0, RAIL_WIDTH - (terminalWidth - contentWidth));
}
/** Terminals narrower than this hide the rail: the transcript needs the columns more than the navigator. */
export const MIN_TERMINAL_WIDTH = 60;
/** A one-prompt timeline is noise. */
export const MIN_PROMPTS = 2;

const CHEVRON_UP = "▴";
const CHEVRON_DOWN = "▾";
const CARD_BORDER = 2;
const CARD_PADDING = 2;
const MAX_CARD_LINES = 2;
/** Idle time after the last pointer event before a tick drops its preview. */
const HOVER_HIDE_MS = 2000;

export function promptLabel(index: number, text: string): string {
  return `${index + 1}  ${truncateToWidth(text.replace(/\s+/g, " "), 60)}`;
}

export type TimelineHit = { kind: "tick"; index: number } | { kind: "up" } | { kind: "down" };

/** Per-frame rail geometry, shared by the renderer and the hit test so they cannot drift. */
export interface TimelineGeometry {
  height: number;
  /** First and last prompt shown as a tick (a window when there are more prompts than rows). */
  start: number;
  end: number;
  upY: number;
  ticksY: number;
  downY: number;
  /** The prompt that owns the first visible row. */
  active: number | undefined;
  /** Nearest prompt strictly above the viewport top. */
  upTarget: number | undefined;
  /** Nearest prompt strictly below the viewport top. */
  downTarget: number | undefined;
}

export interface TimelineInput {
  prompts: readonly Prompt[];
  viewportTop: number;
  height: number;
  atBottom: boolean;
}

export function timelineGeometry(input: TimelineInput): TimelineGeometry | undefined {
  const count = input.prompts.length;
  const maxTicks = input.height - 2;
  if (count < MIN_PROMPTS || maxTicks < 1) return undefined;

  let active: number | undefined;
  let upTarget: number | undefined;
  let downTarget: number | undefined;
  for (let index = 0; index < count; index++) {
    const row = input.prompts[index].row;
    if (row <= input.viewportTop) active = index;
    if (row < input.viewportTop) upTarget = index;
    if (downTarget === undefined && row > input.viewportTop) downTarget = index;
  }

  const tailStart = count - maxTicks;
  const start =
    count <= maxTicks
      ? 0
      : input.atBottom
        ? Math.min(active ?? tailStart, tailStart)
        : Math.min(Math.max(0, (active ?? count - 1) - Math.floor(maxTicks / 2)), tailStart);
  const end = Math.min(count, start + maxTicks);

  const totalRows = end - start + 2;
  const top = Math.max(0, Math.floor((input.height - totalRows) / 2));
  const ticksY = top + 1;
  return {
    height: input.height,
    start,
    end,
    upY: top,
    ticksY,
    downY: ticksY + (end - start),
    active,
    upTarget,
    downTarget,
  };
}

export function hitTest(geometry: TimelineGeometry, row: number): TimelineHit | undefined {
  if (row === geometry.upY) return { kind: "up" };
  if (row === geometry.downY) return { kind: "down" };
  if (row >= geometry.ticksY && row < geometry.downY) {
    return { kind: "tick", index: geometry.start + row - geometry.ticksY };
  }
  return undefined;
}

/** Where a hit jumps to; a chevron without a target is dim and clicking it does nothing. */
export function jumpTarget(geometry: TimelineGeometry, hit: TimelineHit): number | undefined {
  switch (hit.kind) {
    case "tick":
      return hit.index;
    case "up":
      return geometry.upTarget;
    case "down":
      return geometry.downTarget;
  }
}

function chevron(glyph: string, hovered: boolean, enabled: boolean, theme: Theme): string {
  if (!enabled) return theme.fg("dim", glyph);
  return theme.fg(hovered ? "text" : "muted", glyph);
}

function tick(index: number, geometry: TimelineGeometry, hovered: TimelineHit | undefined, theme: Theme): string {
  if (geometry.active === index) return theme.bold(theme.fg("text", "━━"));
  if (hovered?.kind === "tick" && hovered.index === index) return theme.fg("text", "──");
  return ` ${theme.fg("dim", "─")}`;
}

/** One line per transcript row; ticks are stacked between the chevron rows, centered vertically. */
export function railRows(geometry: TimelineGeometry, hovered: TimelineHit | undefined, theme: Theme): string[] {
  const rows = Array.from({ length: geometry.height }, () => "  ");
  rows[geometry.upY] = ` ${chevron(CHEVRON_UP, hovered?.kind === "up", geometry.upTarget !== undefined, theme)}`;
  rows[geometry.downY] =
    ` ${chevron(CHEVRON_DOWN, hovered?.kind === "down", geometry.downTarget !== undefined, theme)}`;
  for (let index = geometry.start; index < geometry.end; index++) {
    rows[geometry.ticksY + index - geometry.start] = tick(index, geometry, hovered, theme);
  }
  return rows;
}

/** Text columns for the hover card: `clamp(transcriptWidth / 2, 16, 32)`. */
export function cardTextWidth(columns: number): number {
  return Math.min(32, Math.max(16, Math.floor(columns / 2)));
}

/** Up to two lines of the prompt: the first cut at `maxText`, the second ellipsized. */
export function hoverCardLines(text: string, maxText: number): string[] {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return [];
  const first = truncateToWidth(flat, maxText, "");
  const rest = flat.slice(first.length).trimStart();
  const lines = [first];
  if (rest) lines.push(truncateToWidth(rest, maxText, "…"));
  return lines.slice(0, MAX_CARD_LINES);
}

export interface HoverCardState {
  lines: string[];
  width: number;
  row: number;
  col: number;
}

/** Card left of the rail, vertically centered on the tick row and clamped to the screen. */
export function hoverCardState(
  text: string,
  tickRow: number,
  columns: number,
  rows: number,
): HoverCardState | undefined {
  const lines = hoverCardLines(text, cardTextWidth(columns));
  if (lines.length === 0) return undefined;
  const width = Math.max(...lines.map((line) => visibleWidth(line))) + CARD_BORDER + CARD_PADDING;
  const height = lines.length + 2;
  return {
    lines,
    width,
    row: Math.min(Math.max(0, tickRow - Math.floor(height / 2)), Math.max(0, rows - height)),
    col: Math.max(0, columns - RAIL_WIDTH - width),
  };
}

/** Floating prompt preview; the overlay options are mutated in place and read on every render. */
export class TimelineHoverCard implements Component {
  readonly options: OverlayOptions;
  /** Called when the pointer reaches the card, so the rail drops the tick it was previewing. */
  onDismiss: (() => void) | undefined;
  private state: HoverCardState | undefined;
  private readonly getTheme: () => Theme;

  constructor(getTheme: () => Theme) {
    this.getTheme = getTheme;
    this.options = {
      row: 0,
      col: 0,
      width: RAIL_WIDTH,
      nonCapturing: true,
      visible: () => this.state !== undefined,
    };
  }

  show(state: HoverCardState): void {
    this.state = state;
    this.options.row = state.row;
    this.options.col = state.col;
    this.options.width = state.width;
  }

  hide(): void {
    this.state = undefined;
  }

  render(width: number): string[] {
    const state = this.state;
    if (!state) return [];
    return frame(state.lines, width, this.getTheme(), { color: "border" });
  }

  /** The pointer left the rail onto the card: drop the preview, but let a wheel scroll Pi's transcript. */
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    this.hide();
    this.onDismiss?.();
    return event.type === "wheel" ? undefined : { handled: true, render: true };
  }

  invalidate(): void {}
}

interface Layout {
  prompts: Prompt[];
  geometry: TimelineGeometry;
}

export class TimelineRail implements Component {
  private readonly tui: ScrollableTui;
  private readonly getTheme: () => Theme;
  private readonly onError: (error: Error) => void;
  private readonly card: TimelineHoverCard | undefined;
  /** Reports how many transcript columns the rail covers; the tools area pads right-aligned text by it. */
  private readonly publish: (covered: number) => void;
  private hovered: TimelineHit | undefined;
  private disabled = false;
  private covered = 0;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  /** Layout computed by `visible()` (or by the last render) and reused by the next render in the same frame. */
  private layoutCache: Layout | undefined;

  constructor(
    tui: ScrollableTui,
    getTheme: () => Theme,
    onError: (error: Error) => void,
    publish: (covered: number) => void,
    card?: TimelineHoverCard,
  ) {
    this.tui = tui;
    this.getTheme = getTheme;
    this.onError = onError;
    this.publish = publish;
    this.card = card;
    if (card) card.onDismiss = () => this.clearHover();
  }

  private layout(): Layout | undefined {
    const transcript = collectPrompts(this.tui);
    if (transcript instanceof Error) {
      this.disable(transcript);
      return undefined;
    }
    const height = transcriptViewportHeight(this.tui);
    if (height instanceof Error) {
      this.disable(height);
      return undefined;
    }
    const geometry = timelineGeometry({
      prompts: transcript.prompts,
      viewportTop: this.tui.viewportTop,
      height,
      atBottom: this.tui.viewportTop + height >= transcript.total,
    });
    return geometry ? { prompts: transcript.prompts, geometry } : undefined;
  }

  private disable(error: Error): void {
    if (this.disabled) return;
    this.disabled = true;
    this.resetHover();
    this.onError(error);
  }

  /** Eligibility, also used as the overlay's `visible` gate so Pi's own scrollbar works while the rail is off. */
  visible(): boolean {
    if (this.disabled) {
      this.publishCovered(0);
      return false;
    }
    const layout = this.tui.terminal.columns >= MIN_TERMINAL_WIDTH ? this.layout() : undefined;
    if (!layout) {
      this.layoutCache = undefined;
      this.resetHover();
      this.publishCovered(0);
      return false;
    }
    this.layoutCache = layout;
    this.publishCovered(this.overlap());
    return true;
  }

  private overlap(): number {
    const width = transcriptWidth(this.tui);
    if (width instanceof Error) return RAIL_WIDTH;
    return railOverlap(this.tui.terminal.columns, width);
  }

  /**
   * Publish how much of a transcript row the rail covers. The frame already drawn read the previous value, so the
   * transcript draws once more with the new one.
   */
  private publishCovered(columns: number): void {
    if (this.covered === columns) return;
    this.covered = columns;
    this.publish(columns);
    this.tui.requestRender();
  }

  private cardState(layout: Layout, index: number): HoverCardState | undefined {
    const prompt = layout.prompts[index];
    if (!prompt) return undefined;
    const columns = this.tui.terminal.columns;
    return hoverCardState(
      prompt.text,
      layout.geometry.ticksY + index - layout.geometry.start,
      columns,
      this.tui.terminal.rows,
    );
  }

  private setHovered(layout: Layout, hit: TimelineHit | undefined): void {
    this.hovered = hit;
    const state = hit?.kind === "tick" ? this.cardState(layout, hit.index) : undefined;
    if (state) this.card?.show(state);
    else this.card?.hide();
    this.armHoverTimer();
  }

  private resetHover(): void {
    this.clearHoverTimer();
    this.hovered = undefined;
    this.card?.hide();
  }

  private clearHover(): void {
    this.resetHover();
    this.tui.requestRender();
  }

  /** A fast pointer can skip the cells between the rail and the card, so an idle tick drops its preview. */
  private armHoverTimer(): void {
    this.clearHoverTimer();
    if (this.hovered?.kind !== "tick") return;
    const timer = setTimeout(() => {
      this.hoverTimer = undefined;
      this.clearHover();
    }, HOVER_HIDE_MS);
    (timer as { unref?: () => void }).unref?.();
    this.hoverTimer = timer;
  }

  private clearHoverTimer(): void {
    if (this.hoverTimer !== undefined) clearTimeout(this.hoverTimer);
    this.hoverTimer = undefined;
  }

  render(width: number): string[] {
    if (this.disabled) return [];
    const layout = this.layoutCache ?? this.layout();
    this.layoutCache = undefined;
    if (!layout) return [];

    // A copy takes the screen as drawn, overlays included. Blank rows keep the ticks out of it and still cover
    // Pi's scrollbar, which a copy would pick up too.
    if (this.tui.hasActiveSelection()) {
      this.resetHover();
      return Array.from({ length: layout.geometry.height }, () => " ".repeat(width));
    }

    const hovered = this.hovered;
    const state =
      hovered?.kind === "tick" && hovered.index >= layout.geometry.start && hovered.index < layout.geometry.end
        ? this.cardState(layout, hovered.index)
        : undefined;
    if (state) this.card?.show(state);
    else this.card?.hide();

    return railRows(layout.geometry, hovered, this.getTheme()).map((row) => truncateToWidth(row, width, "", true));
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (this.disabled) return undefined;
    // A wheel over the rail scrolls the transcript natively.
    if (event.type === "wheel") {
      if (this.hovered) this.clearHover();
      return undefined;
    }

    const layout = this.layout();
    if (!layout) return undefined;
    this.layoutCache = layout;
    const hit = hitTest(layout.geometry, event.y);

    if (event.type === "move") {
      // While a press is held Pi keeps routing moves here even outside the rail; those are a leave.
      const inside = event.x >= 0 && event.x < RAIL_WIDTH;
      const next = inside ? hit : undefined;
      const changed = !sameHit(next, this.hovered);
      if (changed) this.setHovered(layout, next);
      else this.armHoverTimer();
      return { handled: true, render: changed };
    }

    if (event.type === "click" && event.button === "left") {
      const target = hit ? jumpTarget(layout.geometry, hit) : undefined;
      if (this.hovered) this.setHovered(layout, undefined);
      if (target !== undefined) jumpTo(this.tui, layout.prompts[target].row);
      return { handled: true };
    }

    this.armHoverTimer();
    return { handled: true };
  }

  invalidate(): void {}
}

function sameHit(a: TimelineHit | undefined, b: TimelineHit | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.kind === "tick" && b.kind === "tick") return a.index === b.index;
  return a.kind === b.kind;
}
