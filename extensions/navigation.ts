import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { asScrollable, collectPrompts, jumpTo, type ScrollableTui } from "../src/internals/transcript.ts";
import { promptLabel, RAIL_WIDTH, TimelineHoverCard, TimelineRail } from "../src/navigation/timeline.ts";

export default function (pi: ExtensionAPI) {
  let tuiRef: ScrollableTui | undefined;
  let timelineDisabledReason: string | undefined;
  let timelineShown = false;

  // Session replacement invalidates the ctx the overlays were created with, so errors are reported through a
  // callback that session_start refreshes and session_shutdown clears.
  let notify: ((message: string, level: "warning") => void) | undefined;
  // Overlays outlive the widget factory call that created them; the factory hands us a theme that stays valid.
  let theme: Theme;

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    notify = (message, level) => ctx.ui.notify(message, level);
    ctx.ui.setWidget("pi-tune-navigation", (tui, widgetTheme) => {
      theme = widgetTheme;

      if (!timelineShown && timelineDisabledReason === undefined) {
        const scrollable = asScrollable(tui);
        if (!scrollable) {
          timelineDisabledReason = "TUI has no scrollable transcript";
          notify?.(`pi-tune timeline disabled: ${timelineDisabledReason}`, "warning");
        } else {
          tuiRef = scrollable;
          timelineShown = true;
          const card = new TimelineHoverCard(() => theme);
          const rail = new TimelineRail(
            scrollable,
            () => theme,
            (error) => {
              if (timelineDisabledReason === undefined) {
                timelineDisabledReason = error.message;
                notify?.(`pi-tune timeline disabled: ${error.message}`, "warning");
              }
            },
            card,
          );
          // The rail only exists while it has something to show; Pi's own scrollbar works otherwise.
          tui.showOverlay(rail, {
            anchor: "top-right",
            width: RAIL_WIDTH,
            nonCapturing: true,
            visible: () => rail.visible(),
          });
          tui.showOverlay(card, card.options);
        }
      }

      return { render: () => [], invalidate() {} };
    });
  });

  pi.on("session_shutdown", async () => {
    notify = undefined;
  });

  pi.registerCommand("timeline", {
    description: "Jump to a prompt in this session",
    handler: async (_args, ctx) => {
      const tui = tuiRef;
      if (ctx.mode !== "tui" || !tui) {
        ctx.ui.notify("Timeline needs fullscreen mode", "warning");
        return;
      }
      if (timelineDisabledReason !== undefined) {
        ctx.ui.notify(`pi-tune timeline disabled: ${timelineDisabledReason}`, "warning");
        return;
      }
      const transcript = collectPrompts(tui);
      if (transcript instanceof Error) {
        timelineDisabledReason = transcript.message;
        ctx.ui.notify(`pi-tune timeline disabled: ${transcript.message}`, "warning");
        return;
      }
      const labels = transcript.prompts.map((prompt, index) => promptLabel(index, prompt.text));
      const choice = await ctx.ui.select("Prompts in this session", labels);
      if (choice === undefined) return;
      const index = labels.indexOf(choice);
      if (index >= 0) jumpTo(tui, transcript.prompts[index].row);
    },
  });
}
