import { basename, join } from "node:path";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import {
  type ContextUsage,
  type ExtensionContext,
  type MessageEndEvent,
  type MessageUpdateEvent,
  VERSION,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { type FooterParts, type FooterStats, footerLine, streamRate } from "./footer.ts";
import { headerLine } from "./header.ts";
import { formatHints, type HintState, hintFor } from "./hints.ts";
import { configuredServers, connectedServers, readMcpFile } from "./mcp.ts";
import { sessionUsage } from "./usage.ts";

/** What the chrome session reads from the running Pi instance; injected so tests can fake it. */
export interface ChromeHost {
  /** `pi.getCommands()`: skill commands are counted in the header. */
  commands(): readonly { source: string }[];
  /** `pi.getAllTools()`: MCP tool names say which servers connected. */
  allTools(): readonly { name: string }[];
  /** `pi.getMcpServers()`: registered servers count as configured even without a config file. */
  mcpServers(): readonly { name: string }[];
  /** `pi.getSettings()`. */
  settings(): { compaction?: { enabled?: boolean } };
  /** `getAgentDir()`: where the user-level `mcp.json` lives. */
  agentDir(): string;
  /** The clock; `Date.now` in the extension. */
  now(): number;
  /** Whether Pi's editor has focus; `editorHasFocus` in the extension (a Pi-internals probe). */
  editorFocused(tui: TUI): boolean | Error;
}

/** The part of Pi's `ExtensionContext` the chrome session uses. */
export interface ChromeContext {
  cwd: string;
  model: ExtensionContext["model"];
  isProjectTrusted(): boolean;
  getContextUsage(): ContextUsage | undefined;
  ui: Pick<ExtensionContext["ui"], "notify" | "getEditorText" | "setHeader" | "setFooter">;
  sessionManager: Pick<ExtensionContext["sessionManager"], "getEntries">;
}

export interface ChromeSession {
  /** `pi-tune:editor-ready`: the editor area mounted its custom editor. */
  editorReady(): void;
  /** `pi-tune:editor-stash`: a draft sits in the editor's stash. */
  editorStash(held: boolean): void;
  /** `BTW_MODE_CHANNEL`: a btw side thread holds the drawer and the input. */
  btwMode(open: boolean): void;
  agentStart(): void;
  turnStart(): void;
  agentSettled(): void;
  messageUpdate(event: MessageUpdateEvent): void;
  messageEnd(event: MessageEndEvent): void;
  start(ctx: ChromeContext): void;
  shutdown(): void;
}

/** Text and thinking tokens only; tool-call streaming does not start the clock. */
function isWriting(event: AssistantMessageEvent): boolean {
  switch (event.type) {
    case "thinking_start":
    case "thinking_delta":
    case "thinking_end":
    case "text_start":
    case "text_delta":
    case "text_end":
      return true;
    default:
      return false;
  }
}

export function createChromeSession(host: ChromeHost): ChromeSession {
  let current: ChromeContext | undefined;
  let running = false;
  let stashReady = false;
  let stashHeld = false;
  let btwOpen = false;
  /** The focus check warned once; a second warning would repeat on every frame. */
  let focusWarned = false;
  let tui: TUI | undefined;
  /** First text or thinking token of the streaming message, cleared when it ends. */
  let streamStartedAt: number | undefined;
  /** Output tokens of the streaming message, from its partial usage. */
  let streamOutputTokens = 0;
  /**
   * Last measured rate. A message too short to measure (under a second, or a provider that reports output tokens
   * only at the end) keeps it instead of clearing it, so the footer does not flicker.
   */
  let rate: number | undefined;
  /** When the current turn's model request started, from `turn_start`. */
  let requestStartedAt: number | undefined;
  /**
   * Wait of the latest request for its first token. Kept after the message ends so the footer does not
   * flicker, and replaced by the next turn's measurement.
   */
  let ttft: number | undefined;
  /** Enabled MCP servers from the config files, read once per session. */
  let mcpConfigured = 0;

  function reset(): void {
    running = false;
    stashReady = false;
    stashHeld = false;
    btwOpen = false;
    focusWarned = false;
    streamStartedAt = undefined;
    streamOutputTokens = 0;
    rate = undefined;
    requestStartedAt = undefined;
    ttft = undefined;
  }

  function render(): void {
    tui?.requestRender();
  }

  return {
    editorReady() {
      stashReady = true;
      render();
    },
    editorStash(held) {
      stashHeld = held;
      render();
    },
    btwMode(open) {
      btwOpen = open;
      render();
    },
    agentStart() {
      running = true;
      streamStartedAt = undefined;
      streamOutputTokens = 0;
      requestStartedAt = undefined;
      ttft = undefined;
      render();
    },
    turnStart() {
      requestStartedAt = host.now();
      render();
    },
    agentSettled() {
      running = false;
      render();
    },
    messageUpdate(event) {
      if (event.message.role !== "assistant") return;
      if (!isWriting(event.assistantMessageEvent)) return;
      const now = host.now();
      if (streamStartedAt === undefined && requestStartedAt !== undefined) ttft = now - requestStartedAt;
      streamStartedAt ??= now;
      streamOutputTokens = event.message.usage.output;
      render();
    },
    messageEnd(event) {
      if (event.message.role !== "assistant") return;
      const started = streamStartedAt;
      streamStartedAt = undefined;
      streamOutputTokens = 0;
      if (started === undefined) return;
      rate = streamRate(event.message.usage.output, started, host.now()) ?? rate;
      render();
    },
    start(ctx) {
      current = ctx;
      reset();
      const notify = (message: string, level: "warning"): void => ctx.ui.notify(message, level);
      const userConfig = readMcpFile(join(host.agentDir(), "mcp.json"), notify);
      const projectConfig = ctx.isProjectTrusted() ? readMcpFile(join(ctx.cwd, ".pi", "mcp.json"), notify) : undefined;
      const registered = host.mcpServers().map((server) => server.name);
      mcpConfigured = configuredServers({ user: userConfig, project: projectConfig }, registered).length;

      ctx.ui.setHeader((_headerTui, theme) => ({
        render(width: number): string[] {
          const session = current;
          if (!session) return [];
          // Servers connect in the background after start, so the connected count is read per render.
          const skills = host.commands().filter((command) => command.source === "skill").length;
          const connected = connectedServers(host.allTools().map((tool) => tool.name)).length;
          const parts = {
            version: VERSION,
            cwd: basename(session.cwd),
            skills,
            mcp: { connected, configured: mcpConfigured },
          };
          // The timeline rail covers the chat's one-column right padding and Pi's scrollbar column, so the
          // header keeps that padding too; otherwise the rail eats the last character of the right counts.
          return [headerLine(parts, width - 1, theme)];
        },
        invalidate() {},
      }));

      ctx.ui.setFooter((footerTui, theme, footerData) => {
        tui = footerTui;
        const unsubscribe = footerData.onBranchChange(() => footerTui.requestRender());
        return {
          render(width: number): string[] {
            const session = current;
            if (!session) return [];
            const usage = sessionUsage(session.sessionManager.getEntries());
            const context = session.getContextUsage();
            const settings = host.settings();
            const stats: FooterStats = {
              input: usage.input,
              output: usage.output,
              cacheRead: usage.cacheRead,
              cacheWrite: usage.cacheWrite,
              cacheHitPercent: usage.cacheHitPercent,
              cost: usage.cost,
              contextPercent: context?.percent ?? null,
              contextWindow: context?.contextWindow ?? session.model?.contextWindow ?? 0,
              autoCompact: settings.compaction?.enabled !== false,
              rate:
                (streamStartedAt === undefined
                  ? undefined
                  : streamRate(streamOutputTokens, streamStartedAt, host.now())) ?? rate,
              ttftMs: ttft,
            };
            const state: HintState = {
              draft: session.ui.getEditorText().trim() ? "text" : "empty",
              running,
              editor: stashReady,
              stash: stashHeld ? "held" : "none",
              btw: btwOpen,
            };
            // Every hint names a key the focused editor answers: with a dialog focused, all of them are wrong.
            const focused = host.editorFocused(footerTui);
            if (focused instanceof Error && !focusWarned) {
              focusWarned = true;
              session.ui.notify(`pi-tune chrome: ${focused.message} Key hints stay visible.`, "warning");
            }
            const hints = focused === false ? "" : formatHints(hintFor(state), theme);
            const parts: FooterParts = {
              project: basename(session.cwd),
              branch: footerData.getGitBranch() ?? undefined,
              hints,
              stats,
              statuses: Array.from(footerData.getExtensionStatuses().entries()),
            };
            return footerLine(parts, width, theme);
          },
          invalidate() {},
          dispose: unsubscribe,
        };
      });
    },
    shutdown() {
      current = undefined;
      reset();
      mcpConfigured = 0;
      render();
    },
  };
}
