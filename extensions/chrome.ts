import { basename } from "node:path";
import type { AssistantMessageEvent, Usage } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionContext, type SessionEntry, VERSION } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { type FooterParts, type FooterStats, footerLine, streamRate } from "../src/chrome/footer.ts";
import { headerLine } from "../src/chrome/header.ts";
import { formatHints, hintFor } from "../src/chrome/hints.ts";

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  cacheHitPercent?: number;
}

function addUsage(totals: UsageTotals, usage: Usage): void {
  totals.input += usage.input;
  totals.output += usage.output;
  totals.cacheRead += usage.cacheRead;
  totals.cacheWrite += usage.cacheWrite;
  totals.cost += usage.cost.total;
}

/** Pi's footer totals: every usage record in the session, plus the latest assistant cache hit rate. */
function sessionUsage(entries: readonly SessionEntry[]): UsageTotals {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  for (const entry of entries) {
    if (entry.type === "usage") {
      addUsage(totals, entry.usage);
    } else if (entry.type === "message") {
      const message = entry.message;
      if (message.role === "assistant") {
        addUsage(totals, message.usage);
        const prompt = message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
        totals.cacheHitPercent = prompt > 0 ? (message.usage.cacheRead / prompt) * 100 : undefined;
      } else if (message.role === "toolResult" && message.usage) {
        addUsage(totals, message.usage);
      }
    } else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
      addUsage(totals, entry.usage);
    }
  }
  return totals;
}

export default function (pi: ExtensionAPI) {
  let current: ExtensionContext | undefined;
  let running = false;
  let stashReady = false;
  let tui: TUI | undefined;
  /** First text or thinking token of the streaming message, cleared when it ends. */
  let streamStartedAt: number | undefined;
  /** Output tokens of the streaming message, from its partial usage. */
  let streamOutputTokens = 0;
  /** Final rate of the last finished message, shown until the next one streams. */
  let rate: number | undefined;

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

  pi.events.on("pi-tune:editor-ready", () => {
    stashReady = true;
    tui?.requestRender();
  });

  pi.on("agent_start", () => {
    running = true;
    streamStartedAt = undefined;
    streamOutputTokens = 0;
    tui?.requestRender();
  });

  pi.on("agent_settled", () => {
    running = false;
    tui?.requestRender();
  });

  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant") return;
    if (!isWriting(event.assistantMessageEvent)) return;
    streamStartedAt ??= Date.now();
    streamOutputTokens = event.message.usage.output;
    tui?.requestRender();
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const started = streamStartedAt;
    streamStartedAt = undefined;
    streamOutputTokens = 0;
    if (started === undefined) return;
    rate = streamRate(event.message.usage.output, started, Date.now());
    tui?.requestRender();
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    current = ctx;
    running = false;
    stashReady = false;
    streamStartedAt = undefined;
    streamOutputTokens = 0;
    rate = undefined;

    ctx.ui.setHeader((_headerTui, theme) => ({
      render(width: number): string[] {
        const session = current;
        if (!session) return [];
        return [headerLine({ version: VERSION, cwd: basename(session.cwd) }, width, theme)];
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
          const settings = pi.getSettings();
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
            rate: streamStartedAt === undefined ? rate : streamRate(streamOutputTokens, streamStartedAt, Date.now()),
          };
          const state = running ? (session.ui.getEditorText().trim() ? "busy-typing" : "busy-empty") : "idle";
          const hints = formatHints(hintFor(state, { stash: stashReady }), theme);
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
  });

  pi.on("session_shutdown", () => {
    current = undefined;
    running = false;
    stashReady = false;
    streamStartedAt = undefined;
    streamOutputTokens = 0;
    rate = undefined;
    tui?.requestRender();
  });
}
