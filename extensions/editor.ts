import type { ExtensionAPI, ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { PastePreview, type PastePreviewAction } from "../src/editor/paste-preview.ts";
import { TuneEditor } from "../src/editor/tune-editor.ts";

export default function (pi: ExtensionAPI) {
  let model = "no model";
  let thinking = "off";
  let tui: TUI | undefined;
  let editor: TuneEditor | undefined;

  const sync = () => {
    editor?.setStatus(model, thinking);
    tui?.requestRender();
  };

  pi.on("model_select", (event) => {
    model = event.model.id;
    sync();
  });

  pi.on("thinking_level_select", (event) => {
    thinking = event.level;
    sync();
  });

  async function openPreview(ctx: ExtensionContext, editor: TuneEditor, id: number): Promise<void> {
    const content = editor.readPaste(id);
    if (content instanceof Error) {
      ctx.ui.notify(`pi-tune paste preview unavailable: ${content.message}`, "warning");
      return;
    }
    const action = await ctx.ui.custom<PastePreviewAction | undefined>(
      (_tui, theme, _keybindings, done) => new PastePreview(theme, id, content, done),
      { overlay: true, overlayOptions: { width: "80%", maxHeight: 14, margin: 2 } },
    );
    if (action === "expand") editor.expandMarker(id, content);
    else if (action === "delete") editor.deleteMarker(id);
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    model = ctx.model?.id ?? "no model";
    thinking = pi.getThinkingLevel();

    ctx.ui.setEditorComponent((editorTui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
      tui = editorTui;
      const settings = pi.getSettings();
      editor = new TuneEditor(editorTui, theme, keybindings, {
        model,
        thinking,
        paddingX: settings.editorPaddingX,
        autocompleteMaxVisible: settings.autocompleteMaxVisible,
        onPreview: (id) => {
          const current = editor;
          if (!current) return;
          void openPreview(ctx, current, id).catch((error: unknown) => {
            ctx.ui.notify(`pi-tune paste preview failed: ${String(error)}`, "error");
          });
        },
      });
      return editor;
    });
  });
}
