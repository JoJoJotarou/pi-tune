import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  appendToDocument,
  asFlippable,
  asScrollable,
  collectPrompts,
  FlipSpacer,
  jumpTo,
  type ScrollableTui,
} from "../src/internals/transcript.ts";
import { StickyBar } from "../src/navigation/sticky.ts";
import { promptLabel, TimelineRail } from "../src/navigation/timeline.ts";

export default function (pi: ExtensionAPI) {
  let tuiRef: ScrollableTui | undefined;
  let disabledReason: string | undefined;
  let stickyDisabledReason: string | undefined;
  let flipDisabledReason: string | undefined;
  let stickyShown = false;
  let flipInstalled = false;

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget("pi-tune-rail", (tui, _theme) => {
      if (!tuiRef && disabledReason === undefined) {
        const scrollable = asScrollable(tui);
        if (scrollable) {
          tuiRef = scrollable;
          const rail = new TimelineRail(
            scrollable,
            () => ctx.ui.theme,
            (error) => {
              if (disabledReason === undefined) {
                disabledReason = error.message;
                ctx.ui.notify(`pi-tune timeline disabled: ${error.message}`, "warning");
              }
            },
          );
          tui.showOverlay(rail, { anchor: "top-right", width: 1, nonCapturing: true });
        }
      }
      if (!stickyShown && stickyDisabledReason === undefined) {
        const scrollable = asScrollable(tui);
        if (scrollable) {
          stickyShown = true;
          const sticky = new StickyBar(
            scrollable,
            () => ctx.ui.theme,
            (error) => {
              if (stickyDisabledReason === undefined) {
                stickyDisabledReason = error.message;
                ctx.ui.notify(`pi-tune sticky prompt disabled: ${error.message}`, "warning");
              }
            },
          );
          tui.showOverlay(sticky, { anchor: "top-left", width: "100%", nonCapturing: true });
        }
      }
      if (!flipInstalled && flipDisabledReason === undefined) {
        const flippable = asFlippable(tui);
        if (!flippable) {
          flipDisabledReason = "TUI has no scrollToBottom";
          ctx.ui.notify(`pi-tune page flip disabled: ${flipDisabledReason}`, "warning");
        } else {
          const spacer = new FlipSpacer(flippable, (error) => {
            if (flipDisabledReason === undefined) {
              flipDisabledReason = error.message;
              ctx.ui.notify(`pi-tune page flip disabled: ${error.message}`, "warning");
            }
          });
          const failure = appendToDocument(tui, spacer);
          if (failure) {
            flipDisabledReason = failure.message;
            ctx.ui.notify(`pi-tune page flip disabled: ${failure.message}`, "warning");
          } else {
            flipInstalled = true;
          }
        }
      }
      return { render: () => [], invalidate() {} };
    });
  });

  pi.registerCommand("timeline", {
    description: "Jump to a prompt in this session",
    handler: async (_args, ctx) => {
      const tui = tuiRef;
      if (ctx.mode !== "tui" || !tui) {
        ctx.ui.notify("Timeline needs fullscreen mode", "warning");
        return;
      }
      if (disabledReason !== undefined) {
        ctx.ui.notify(`pi-tune timeline disabled: ${disabledReason}`, "warning");
        return;
      }
      const transcript = collectPrompts(tui, tui.terminal.columns);
      if (transcript instanceof Error) {
        disabledReason = transcript.message;
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
