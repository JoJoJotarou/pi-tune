import { join } from "node:path";
import type { Api, AssistantMessage, Model } from "@earendil-works/pi-ai";
import type {
  AgentSettledEvent,
  ExtensionContext,
  KeybindingsManager,
  ModelSelectEvent,
  ThinkingLevelSelectEvent,
  TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { ModelSelectorComponent } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { modelRuntimeOf } from "../internals/model-runtime.ts";
import { MODAL_OVERLAY } from "../shared/frame.ts";
import { PastePreview, type PastePreviewAction } from "./paste-preview.ts";
import { SuggestPanel } from "./suggest-panel.ts";
import {
  loadSuggestSettings,
  parseModelId,
  SUGGEST_STYLES,
  type SuggestSettings,
  saveSuggestSettings,
  suggestCommand,
} from "./suggest-settings.ts";
import { collectSessionTurns, Suggestion, type SuggestionComplete, suggestReasoning } from "./suggestion.ts";
import { TuneEditor } from "./tune-editor.ts";

const SUGGEST_MAX_TOKENS = 1024;

/** What the editor session reads from the running Pi instance; injected so tests can fake it. */
export interface EditorHost {
  settings(): { editorPaddingX?: number; autocompleteMaxVisible?: number };
  /** `pi.getThinkingLevel()`. */
  thinkingLevel(): string;
  /** `getAgentDir()`: where `pi-tune.json` lives. */
  agentDir(): string;
  now(): number;
  /** `pi.events.emit("pi-tune:editor-stash", held)`. */
  emitStash(held: boolean): void;
  /** `pi.events.emit("pi-tune:editor-ready", undefined)`. */
  emitReady(): void;
}

/** The part of Pi's `ExtensionContext` the editor session uses. */
export interface EditorContext {
  mode: ExtensionContext["mode"];
  model: ExtensionContext["model"];
  modelRegistry: ExtensionContext["modelRegistry"];
  cwd: string;
  sessionManager: { getBranch(): readonly unknown[] };
  ui: Pick<ExtensionContext["ui"], "notify" | "custom" | "setEditorComponent" | "theme">;
}

export interface EditorSession {
  /** `BTW_MODE_CHANNEL`: the editor recolors while a btw side thread holds the input. */
  btwMode(on: boolean): void;
  modelSelect(event: ModelSelectEvent): void;
  thinkingLevelSelect(event: ThinkingLevelSelectEvent): void;
  agentStart(): void;
  turnEnd(event: TurnEndEvent): void;
  agentSettled(event: AgentSettledEvent): void;
  sessionCompact(): void;
  start(ctx: EditorContext): void;
  shutdown(): void;
  /** `getArgumentCompletions` of the `/suggest` command. */
  suggestCompletions(prefix: string): { value: string; label: string }[] | null;
  /** The `/suggest` command's handler body. */
  runSuggestCommand(args: string, ctx: EditorContext): Promise<void>;
}

export function createEditorSession(host: EditorHost): EditorSession {
  type Registry = EditorContext["modelRegistry"];

  let model = "no model";
  let thinking = "off";
  let tui: TUI | undefined;
  let editor: TuneEditor | undefined;
  // Session state lives here, not in the editor factory closure: the factory outlives the session that made it.
  let notify: ((message: string, level: "warning" | "error") => void) | undefined;
  let currentTheme: (() => ExtensionContext["ui"]["theme"]) | undefined;
  let openPreviewModal: ((id: number, content: string) => Promise<PastePreviewAction | undefined>) | undefined;

  // --- ghost suggestion state ---
  let chatModel: Model<Api> | undefined;
  let registry: Registry | undefined;
  let suggestion: Suggestion | undefined;
  let suggestPath: string | undefined;
  let suggestSettings: SuggestSettings | undefined;
  let suggestProblem: string | undefined;

  // Kept here too: the btw area may switch modes while no editor exists yet.
  let btwMode = false;

  const sync = () => {
    editor?.setStatus(model, thinking);
    tui?.requestRender();
  };

  const completeSuggestion: SuggestionComplete = async ({ model: target, systemPrompt, userMessage, signal }) => {
    if (!registry) throw new Error("model registry unavailable");
    const chat = target as Model<Api>;
    const auth = await registry.getApiKeyAndHeaders(chat);
    if (!auth.ok) throw new Error(auth.error);
    const response = await registry
      .streamSimple(
        chat,
        {
          systemPrompt,
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: userMessage }],
              timestamp: host.now(),
            },
          ],
        },
        {
          apiKey: auth.apiKey,
          headers: auth.headers,
          signal,
          maxTokens: SUGGEST_MAX_TOKENS,
          temperature: 0.2,
          reasoning: suggestReasoning(chat),
        },
      )
      .result();
    if (response.stopReason === "error") throw new Error(response.errorMessage ?? "provider error");
    return response.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  };

  const availableModelIds = (): string[] =>
    (registry?.getAvailable() ?? []).map((available) => `${available.provider}/${available.id}`);

  /** Saves and applies `next`; returns the settings that ended up in effect. */
  function applySuggestSettings(next: SuggestSettings, ctx: EditorContext): SuggestSettings {
    const current = suggestSettings ?? { enabled: false };
    if (suggestPath === undefined) return current;
    try {
      saveSuggestSettings(suggestPath, next);
    } catch (error) {
      ctx.ui.notify(
        `pi-tune could not save ${suggestPath}: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
      return current;
    }
    suggestSettings = next;
    suggestion?.applySettings(next);
    const state = next.enabled
      ? `Next-step suggestions on · ${next.model ?? "session model"} · ${next.style ?? "careful"}`
      : "Next-step suggestions off";
    ctx.ui.notify(state, "info");
    return next;
  }

  async function openSuggestPanel(ctx: EditorContext): Promise<void> {
    const runtime = modelRuntimeOf(ctx.modelRegistry);
    await ctx.ui.custom<void>((panelTui, _theme, _keybindings, done) => {
      return new SuggestPanel({
        settings: suggestSettings ?? { enabled: false },
        tui: panelTui,
        onChange: (next) => applySuggestSettings(next, ctx),
        onClose: () => done(undefined),
        modelPicker:
          runtime instanceof Error
            ? runtime
            : (picked) => {
                const stored = suggestSettings?.model === undefined ? undefined : parseModelId(suggestSettings.model);
                const current = stored === undefined ? chatModel : ctx.modelRegistry.find(stored.provider, stored.id);
                // The selector refreshes the catalog in the background until it is disposed.
                const selector: ModelSelectorComponent = new ModelSelectorComponent(
                  panelTui,
                  current ?? chatModel,
                  runtime,
                  [],
                  (selected) => {
                    selector.dispose();
                    picked(`${selected.provider}/${selected.id}`);
                  },
                  () => {
                    selector.dispose();
                    picked();
                  },
                );
                return selector;
              },
        onWarning: (message) => ctx.ui.notify(`${message} Use /suggest model <provider/id> instead.`, "warning"),
      });
    });
  }

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

  return {
    btwMode(on) {
      btwMode = on;
      editor?.setBtwMode(btwMode);
    },
    modelSelect(event) {
      model = event.model.id;
      chatModel = event.model;
      suggestion?.setSessionModel(event.model);
      sync();
    },
    thinkingLevelSelect(event) {
      thinking = event.level;
      sync();
    },
    agentStart() {
      suggestion?.agentStart();
    },
    turnEnd(event) {
      void suggestion?.turnEnd(event.message as AssistantMessage, event.toolResults.length);
    },
    agentSettled(event) {
      void suggestion?.agentSettled(event.aborted);
    },
    sessionCompact() {
      suggestion?.discard();
    },
    start(ctx) {
      suggestion?.discard();
      if (ctx.mode !== "tui") return;
      model = ctx.model?.id ?? "no model";
      chatModel = ctx.model;
      registry = ctx.modelRegistry;
      thinking = host.thinkingLevel();
      notify = (message, level) => ctx.ui.notify(message, level);
      suggestPath = join(host.agentDir(), "pi-tune.json");
      const loaded = loadSuggestSettings(suggestPath);
      suggestProblem = loaded.ok ? undefined : loaded.problem;
      suggestSettings = loaded.ok ? loaded.settings : { enabled: false };
      if (suggestProblem !== undefined) ctx.ui.notify(suggestProblem, "warning");
      suggestion = new Suggestion({
        complete: completeSuggestion,
        findModel: (provider, id) => ctx.modelRegistry.find(provider, id),
        sessionModel: () => chatModel,
        collectTurns: () => collectSessionTurns(ctx.sessionManager),
        cwd: () => ctx.cwd,
        editor: () => editor,
        notify: (message, level) => ctx.ui.notify(message, level),
      });
      suggestion.startSession();
      suggestion.applySettings(suggestSettings);
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
        const settings = host.settings();
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
          onAcceptSuggestion: () => suggestion?.accepted(),
          onDismissSuggestion: () => suggestion?.discard(),
          onStashChange: (held) => host.emitStash(held),
        });
        instance.setBtwMode(btwMode);
        editor = instance;
        host.emitReady();
        return instance;
      });
    },
    shutdown() {
      suggestion?.discard();
      suggestion = undefined;
      suggestPath = undefined;
      suggestSettings = undefined;
      suggestProblem = undefined;
      notify = undefined;
      currentTheme = undefined;
      openPreviewModal = undefined;
      editor = undefined;
      tui = undefined;
      registry = undefined;
    },
    suggestCompletions(prefix) {
      const argument = /^(model|style)\s+(\S*)$/.exec(prefix);
      const candidates =
        argument === null
          ? ["on", "off", "model", "style"]
          : argument[1] === "model"
            ? ["session", ...availableModelIds()]
            : [...SUGGEST_STYLES];
      const matches = candidates.filter((candidate) => candidate.startsWith(argument?.[2] ?? prefix));
      if (matches.length === 0) return null;
      return matches.map((match) => ({ value: argument === null ? match : `${argument[1]} ${match}`, label: match }));
    },
    async runSuggestCommand(args, ctx) {
      if (suggestPath === undefined) {
        ctx.ui.notify("pi-tune: /suggest needs an interactive session", "warning");
        return;
      }
      if (suggestProblem !== undefined) {
        ctx.ui.notify(suggestProblem, "warning");
        return;
      }
      const command = args.trim();
      if (command === "") {
        await openSuggestPanel(ctx);
        return;
      }
      const isModel = (value: string) => {
        const parsed = parseModelId(value);
        return parsed !== undefined && ctx.modelRegistry.find(parsed.provider, parsed.id) !== undefined;
      };
      const result = suggestCommand(command, suggestSettings ?? { enabled: false }, isModel);
      if ("error" in result) {
        ctx.ui.notify(result.error, "error");
        return;
      }
      applySuggestSettings(result.settings, ctx);
    },
  };
}
