import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { OverlayHandle, TUI } from "@earendil-works/pi-tui";
import type { ScrollableTui, Transcript } from "../internals/transcript.ts";
import { promptLabel, RAIL_WIDTH, TimelineHoverCard, TimelineRail } from "./timeline.ts";

/** What the navigation session reads from the running Pi instance; injected so tests can fake it. */
export interface NavigationHost {
  /** `asScrollable(tui)`: the transcript surface the rail and the jump need, `undefined` when Pi's shape changed. */
  scrollable(tui: TUI): ScrollableTui | undefined;
  /** `collectPrompts(tui)`: the prompts the `/timeline` picker lists. */
  prompts(tui: ScrollableTui): Transcript | Error;
  /** `jumpTo(tui, row)`: scrolls the transcript so `row` is the first visible row. */
  jumpTo(tui: ScrollableTui, row: number): void;
  /** `pi.events.emit(RAIL_CHANNEL, …)`: how many transcript columns the rail covers. */
  publish(covered: number): void;
}

/** The part of Pi's `ExtensionContext` the navigation session uses. */
export interface NavigationContext {
  mode: ExtensionContext["mode"];
  ui: Pick<ExtensionContext["ui"], "notify" | "select" | "setWidget">;
}

export interface NavigationSession {
  start(ctx: NavigationContext): void;
  shutdown(): void;
  /** The `/timeline` command's handler body. */
  runTimelineCommand(ctx: NavigationContext): Promise<void>;
}

export function createNavigationSession(host: NavigationHost): NavigationSession {
  /** Session replacement invalidates the ctx the overlays were created with, so `start` refreshes it. */
  let current: NavigationContext | undefined;
  let tui: ScrollableTui | undefined;
  let rail: TimelineRail | undefined;
  let overlays: OverlayHandle[] = [];
  /** Why the rail and the command are off. It outlives the session: the TUI shape it reports is the process's. */
  let disabledReason: string | undefined;
  /** The widget factory runs on every mount; the rail is created on the first one only. */
  let shown = false;
  /**
   * The theme of the latest widget factory call. Pi hands a new one on a runtime theme change, and the overlays read
   * it per frame, so a theme change reaches a rail that was mounted under the old one.
   */
  let theme: Theme | undefined;

  function currentTheme(): Theme {
    if (theme === undefined) throw new Error("pi-tune: navigation drew without a widget theme");
    return theme;
  }

  /** Report a Pi-internals or runtime failure once; the feature stays off afterwards. */
  function disable(reason: string): void {
    if (disabledReason !== undefined) return;
    disabledReason = reason;
    current?.ui.notify(`pi-tune timeline disabled: ${reason}`, "warning");
  }

  function mount(widgetTui: TUI): void {
    const scrollable = host.scrollable(widgetTui);
    if (!scrollable) {
      disable("TUI has no scrollable transcript");
      return;
    }
    tui = scrollable;
    shown = true;
    const card = new TimelineHoverCard(currentTheme);
    const created = new TimelineRail(scrollable, currentTheme, (error) => disable(error.message), host.publish, card);
    // The rail only exists while it has something to show; Pi's own scrollbar works otherwise.
    overlays = [
      widgetTui.showOverlay(created, {
        anchor: "top-right",
        width: RAIL_WIDTH,
        nonCapturing: true,
        visible: () => created.visible(),
      }),
      widgetTui.showOverlay(card, card.options),
    ];
    rail = created;
  }

  function reset(): void {
    // Pi keeps rendering these overlays until the process exits, but the runtime they publish on is replaced, so
    // drop the rail and the overlays before Pi draws another frame.
    rail?.dispose();
    rail = undefined;
    for (const overlay of overlays) overlay.hide();
    overlays = [];
    tui = undefined;
    shown = false;
    theme = undefined;
  }

  return {
    start(ctx) {
      current = ctx;
      reset();
      ctx.ui.setWidget("pi-tune-navigation", (widgetTui, widgetTheme) => {
        theme = widgetTheme;
        if (!shown && disabledReason === undefined) mount(widgetTui);
        return { render: () => [], invalidate() {} };
      });
    },
    shutdown() {
      current = undefined;
      reset();
    },
    async runTimelineCommand(ctx) {
      const scrollable = tui;
      if (ctx.mode !== "tui" || !scrollable) {
        ctx.ui.notify("Timeline needs fullscreen mode", "warning");
        return;
      }
      if (disabledReason !== undefined) {
        ctx.ui.notify(`pi-tune timeline disabled: ${disabledReason}`, "warning");
        return;
      }
      const transcript = host.prompts(scrollable);
      if (transcript instanceof Error) {
        disabledReason = transcript.message;
        ctx.ui.notify(`pi-tune timeline disabled: ${transcript.message}`, "warning");
        return;
      }
      const labels = transcript.prompts.map((prompt, index) => promptLabel(index, prompt.text));
      const choice = await ctx.ui.select("Prompts in this session", labels);
      if (choice === undefined) return;
      const index = labels.indexOf(choice);
      if (index >= 0) host.jumpTo(scrollable, transcript.prompts[index].row);
    },
  };
}
