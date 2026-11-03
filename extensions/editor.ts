import type { AnyModel, Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { PastePreview, type PastePreviewAction } from "../src/editor/paste-preview.ts";
import { buildSuggestionPrompt, cleanSuggestion, digestFromReply } from "../src/editor/suggestion.ts";
import { TuneEditor } from "../src/editor/tune-editor.ts";
import { MODAL_OVERLAY } from "../src/shared/frame.ts";

const SUGGEST_CHARS = 80;
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
  let chatModel: AnyModel | undefined;
  let modelRegistry: Registry | undefined;
  let runActive = false;
  let requestedThisRun = false;
  let suggestAbort: AbortController | undefined;

  const sync = () => {
    editor?.setStatus(model, thinking);
    tui?.requestRender();
  };

  const discardSuggestion = () => {
    suggestAbort?.abort();
    suggestAbort = undefined;
    if (editor !== undefined && editor.getSuggestion() !== undefined) editor.setSuggestion(undefined);
  };

  const requestSuggestion = async (replyText: string): Promise<void> => {
    if (!SUGGEST_ENABLED || !editor || !modelRegistry) return;
    const model = resolveSuggestModel(modelRegistry, chatModel) as Model<Api> | undefined;
    if (!model) return;
    requestedThisRun = true;
    const controller = new AbortController();
    suggestAbort = controller;
    try {
      const auth = await modelRegistry.getApiKeyAndHeaders(model);
      // No credentials: this never self-heals, and the working-indicator summary request exits the same way.
      if (!auth.ok || controller.signal.aborted) return;
      const response = await modelRegistry.complete(
        model,
        {
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: buildSuggestionPrompt(digestFromReply(replyText), SUGGEST_CHARS) }],
              timestamp: Date.now(),
            },
          ],
        },
        { apiKey: auth.apiKey, headers: auth.headers, signal: controller.signal, maxTokens: SUGGEST_MAX_TOKENS },
      );
      if (controller.signal.aborted) return;
      const text = response.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      const suggestion = cleanSuggestion(text, SUGGEST_CHARS);
      if (suggestion !== "" && editor.getText().length === 0) editor.setSuggestion(suggestion);
    } catch {
      // Request-level failures (abort, network, provider) just leave the editor empty.
    } finally {
      if (suggestAbort === controller) suggestAbort = undefined;
    }
  };

  pi.on("model_select", (event) => {
    model = event.model.id;
    chatModel = event.model;
    sync();
  });

  pi.on("thinking_level_select", (event) => {
    thinking = event.level;
    sync();
  });

  pi.on("agent_start", () => {
    // A new run invalidates both the old suggestion and this run's request budget.
    discardSuggestion();
    requestedThisRun = false;
    runActive = true;
  });

  pi.on("turn_end", (event) => {
    const message = event.message as AssistantMessage;
    // Only a concluded reply (no pending tool loop) seeds the suggestion.
    if (message.role !== "assistant" || message.stopReason !== "stop" || event.toolResults.length > 0) return;
    if (requestedThisRun || !runActive) return;
    const text = message.content
      .filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    void requestSuggestion(text);
  });

  pi.on("agent_settled", (event) => {
    // Backstop for endings turn_end's concluding gate misses (length cut, terminate).
    if (!event.aborted && runActive && !requestedThisRun) void requestSuggestion("");
    runActive = false;
  });

  pi.on("session_compact", () => discardSuggestion());

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
    discardSuggestion();
    requestedThisRun = false;
    runActive = false;
    if (ctx.mode !== "tui") return;
    model = ctx.model?.id ?? "no model";
    chatModel = ctx.model;
    modelRegistry = ctx.modelRegistry;
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
    discardSuggestion();
    notify = undefined;
    currentTheme = undefined;
    openPreviewModal = undefined;
    editor = undefined;
    tui = undefined;
    modelRegistry = undefined;
  });
}

function resolveSuggestModel(registry: Registry, fallback: AnyModel | undefined): AnyModel | undefined {
  if (!SUGGEST_MODEL) return fallback;
  const slash = SUGGEST_MODEL.indexOf("/");
  if (slash <= 0) return fallback;
  return registry.find(SUGGEST_MODEL.slice(0, slash), SUGGEST_MODEL.slice(slash + 1)) ?? fallback;
}
