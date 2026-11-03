import type { ExtensionAPI, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { PastePreview, type PastePreviewAction } from "../src/editor/paste-preview.ts";
import { TuneEditor } from "../src/editor/tune-editor.ts";
import { MODAL_OVERLAY } from "../src/shared/frame.ts";

export default function (pi: ExtensionAPI) {
  let model = "no model";
  let thinking = "off";
  let tui: TUI | undefined;
  let editor: TuneEditor | undefined;
  // Session state lives here, not in the editor factory closure: the factory outlives the session that made it.
  let notify: ((message: string, level: "warning" | "error") => void) | undefined;
  let currentTheme: (() => Theme) | undefined;
  let openPreviewModal: ((id: number, content: string) => Promise<PastePreviewAction | undefined>) | undefined;

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

  async function preview(target: TuneEditor, id: number): Promise<void> {
    const content = target.readPaste(id);
    if (content instanceof Error) {
      notify?.(`pi-tune paste preview unavailable: ${content.message}`, "warning");
      return;
    }
    const action = await openPreviewModal?.(id, content);
    if (action === "expand") target.expandMarker(id, content);
    else if (action === "delete") target.deleteMarker(id);
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    model = ctx.model?.id ?? "no model";
    thinking = pi.getThinkingLevel();
    notify = (message, level) => ctx.ui.notify(message, level);
    currentTheme = () => ctx.ui.theme;
    openPreviewModal = (id, content) =>
      ctx.ui.custom<PastePreviewAction | undefined>(
        (modalTui, theme, _keybindings, done) => new PastePreview(theme, id, content, modalTui.terminal.rows, done),
        { overlay: true, overlayOptions: MODAL_OVERLAY },
      );

    ctx.ui.setEditorComponent((editorTui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
      const themeOf = currentTheme;
      if (!themeOf) throw new Error("pi-tune: editor created without a session theme");
      tui = editorTui;
      const settings = pi.getSettings();
      const instance = new TuneEditor(editorTui, theme, keybindings, {
        model,
        thinking,
        theme: themeOf,
        paddingX: settings.editorPaddingX,
        autocompleteMaxVisible: settings.autocompleteMaxVisible,
        onPreview: (id) => {
          void preview(instance, id).catch((error: unknown) => {
            notify?.(`pi-tune paste preview failed: ${String(error)}`, "error");
          });
        },
      });
      editor = instance;
      pi.events.emit("pi-tune:editor-ready", undefined);
      return instance;
    });
  });

  pi.on("session_shutdown", () => {
    notify = undefined;
    currentTheme = undefined;
    openPreviewModal = undefined;
    editor = undefined;
    tui = undefined;
  });
}
