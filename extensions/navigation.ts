import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { asScrollable, collectPrompts, jumpTo, type ScrollableTui } from "../src/internals/transcript.ts";
import { promptLabel, TimelineRail } from "../src/navigation/timeline.ts";

export default function (pi: ExtensionAPI) {
  let tuiRef: ScrollableTui | undefined;
  let disabledReason: string | undefined;
  const disable = (reason: string, ui: { notify(message: string, type: "warning"): void }) => {
    disabledReason = reason;
    ui.notify(`pi-tune timeline disabled: ${reason}`, "warning");
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget("pi-tune-rail", (tui, theme) => {
      if (!tuiRef && disabledReason === undefined) {
        const scrollable = asScrollable(tui);
        if (scrollable) {
          tuiRef = scrollable;
          const rail = new TimelineRail(scrollable, theme, (error) => {
            if (disabledReason === undefined) disable(error.message, ctx.ui);
          });
          tui.showOverlay(rail, { anchor: "top-right", width: 1, nonCapturing: true });
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
        disable(transcript.message, ctx.ui);
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
