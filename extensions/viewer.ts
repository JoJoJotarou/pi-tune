import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { collectBlocks } from "../src/viewer/blocks.ts";
import { ViewerComponent } from "../src/viewer/component.ts";

export default function (pi: ExtensionAPI) {
  const open = async (ctx: ExtensionContext): Promise<void> => {
    if (ctx.mode !== "tui") return;
    const blocks = collectBlocks(ctx.sessionManager.getBranch());
    if (blocks.length === 0) {
      ctx.ui.notify("Nothing to view yet", "info");
      return;
    }
    await ctx.ui.custom<void>(
      (tui, theme, _keybindings, done) =>
        new ViewerComponent(
          theme,
          blocks,
          () => done(),
          () => tui.requestRender(),
          tui.terminal.rows,
        ),
      {
        overlay: true,
        overlayOptions: { width: "100%", maxHeight: "80%", anchor: "center" },
      },
    );
  };

  pi.registerShortcut("alt+o", {
    description: "View the latest output block",
    handler: (ctx) => open(ctx),
  });

  pi.registerCommand("view", {
    description: "View the latest output block",
    handler: (_args, ctx) => open(ctx),
  });
}
