import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { PastePreview, type PastePreviewAction } from "../src/editor/paste-preview.ts";
import { collectSessionTurns, Suggestion, type SuggestionComplete } from "../src/editor/suggestion.ts";
import { TuneEditor } from "../src/editor/tune-editor.ts";
import { MODAL_OVERLAY } from "../src/shared/frame.ts";

const SUGGEST_MAX_TOKENS = 1024;

const SUGGEST_ENABLED = process.env.PI_TUNE_EDITOR_SUGGEST !== "off";
const SUGGEST_MODEL = process.env.PI_TUNE_SUGGEST_MODEL;

type Registry = ExtensionContext["modelRegistry"];

export default function (pi: ExtensionAPI) {
  let model = "no model";
  let thinking = "off";
  let tui: TUI | undefined;
  let editor: TuneEditor | undefined;
  // Session state lives here, not in the editor factory closure: the factory outlives the session that made it.
  let notify: ((message: string, level: "warning" | "error") => void) | undefined;
  let currentTheme: (() => Theme) | undefined;
  let openPreviewModal: ((id: number, content: string) => Promise<PastePreviewAction | undefined>) | undefined;

  // --- ghost suggestion state ---
  let chatModel: Model<Api> | undefined;
  let registry: Registry | undefined;
  let suggestion: Suggestion | undefined;

  const sync = () => {
    editor?.setStatus(model, thinking);
    tui?.requestRender();
  };

  const completeSuggestion: SuggestionComplete = async ({ model: target, systemPrompt, userMessage, signal }) => {
    if (!registry) throw new Error("model registry unavailable");
    const chat = target as Model<Api>;
    const auth = await registry.getApiKeyAndHeaders(chat);
    if (!auth.ok) throw new Error(auth.error);
    const response = await registry.complete(
      chat,
      {
        systemPrompt,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: userMessage }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        signal,
        maxTokens: SUGGEST_MAX_TOKENS,
        temperature: 0.2,
      },
    );
    if (response.stopReason === "error") throw new Error(response.errorMessage ?? "provider error");
    return response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  };

  pi.on("model_select", (event) => {
    model = event.model.id;
    chatModel = event.model;
    suggestion?.setSessionModel(event.model);
    sync();
  });

  pi.on("thinking_level_select", (event) => {
    thinking = event.level;
    sync();
  });

  pi.on("agent_start", () => {
    suggestion?.agentStart();
  });

  pi.on("turn_end", (event) => {
    void suggestion?.turnEnd(event.message as AssistantMessage, event.toolResults.length);
  });

  pi.on("agent_settled", (event) => {
    void suggestion?.agentSettled(event.aborted);
  });

  pi.on("session_compact", () => suggestion?.discard());

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
    suggestion?.discard();
    if (ctx.mode !== "tui") return;
    model = ctx.model?.id ?? "no model";
    chatModel = ctx.model;
    registry = ctx.modelRegistry;
    thinking = pi.getThinkingLevel();
    notify = (message, level) => ctx.ui.notify(message, level);
    suggestion = new Suggestion({
      enabled: SUGGEST_ENABLED,
      modelSetting: SUGGEST_MODEL,
      complete: completeSuggestion,
      findModel: (provider, id) => ctx.modelRegistry.find(provider, id),
      sessionModel: () => chatModel,
      collectTurns: () => collectSessionTurns(ctx.sessionManager),
      cwd: () => ctx.cwd,
      editor: () => editor,
      notify: (message, level) => ctx.ui.notify(message, level),
    });
    suggestion.startSession();
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
        onBeforeSubmit: () => suggestion?.discard(),
      });
      editor = instance;
      pi.events.emit("pi-tune:editor-ready", undefined);
      return instance;
    });
  });

  pi.on("session_shutdown", () => {
    suggestion?.discard();
    suggestion = undefined;
    notify = undefined;
    currentTheme = undefined;
    openPreviewModal = undefined;
    editor = undefined;
    tui = undefined;
    registry = undefined;
  });
}
