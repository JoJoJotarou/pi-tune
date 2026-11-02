import { basename } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import {
  type AppKeybinding,
  type ExtensionAPI,
  type ExtensionContext,
  keyText,
  type SessionEntry,
  VERSION,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { type FooterParts, type FooterStats, footerLine } from "../src/chrome/footer.ts";
import { headerLine } from "../src/chrome/header.ts";
import { formatHints, hintFor } from "../src/chrome/hints.ts";
import { type KeyGroup, KeysComponent } from "../src/chrome/keys.ts";
import { MODAL_OVERLAY } from "../src/shared/frame.ts";

// Global keys only; selector-specific ones (tree, session list, model scope) belong to those screens.
const PI_KEYBINDINGS: readonly AppKeybinding[] = [
  "app.interrupt",
  "app.clear",
  "app.exit",
  "app.suspend",
  "app.thinking.cycle",
  "app.model.cycleForward",
  "app.model.cycleBackward",
  "app.model.select",
  "app.tools.expand",
  "app.thinking.toggle",
  "app.editor.external",
  "app.message.copy",
  "app.message.followUp",
  "app.message.dequeue",
  "app.clipboard.pasteImage",
  "app.session.new",
  "app.session.tree",
  "app.session.fork",
  "app.session.resume",
];

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

function piGroups(keybindings: { getDefinition(id: AppKeybinding): { description?: string } | undefined }): KeyGroup[] {
  return [
    {
      title: "Pi",
      entries: PI_KEYBINDINGS.flatMap((id) => {
        const key = keyText(id);
        if (!key) return [];
        return [{ key, description: keybindings.getDefinition(id)?.description ?? id }];
      }),
    },
    {
      title: "pi-tune",
      entries: [
        { key: "alt+o", description: "View the latest output block" },
        { key: "ctrl+s", description: "Stash the draft" },
        { key: "click", description: "Expand a tool or thinking block" },
      ],
    },
  ];
}

export default function (pi: ExtensionAPI) {
  let current: ExtensionContext | undefined;
  let running = false;
  let stashReady = false;
  let tui: TUI | undefined;
  let streamStartedAt: number | undefined;
  let rate: number | undefined;

  pi.events.on("pi-tune:editor-ready", () => {
    stashReady = true;
    tui?.requestRender();
  });

  pi.on("agent_start", () => {
    running = true;
    streamStartedAt = undefined;
    tui?.requestRender();
  });

  pi.on("agent_settled", () => {
    running = false;
    tui?.requestRender();
  });

  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant") return;
    if (streamStartedAt === undefined) streamStartedAt = Date.now();
  });

  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const started = streamStartedAt;
    streamStartedAt = undefined;
    if (started === undefined) return;
    const seconds = (Date.now() - started) / 1000;
    if (seconds <= 0) return;
    rate = event.message.usage.output / seconds;
    tui?.requestRender();
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    current = ctx;
    running = false;
    stashReady = false;
    streamStartedAt = undefined;
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
            rate,
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
    rate = undefined;
    tui?.requestRender();
  });

  pi.registerCommand("keys", {
    description: "Show Pi and pi-tune key bindings",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return;
      await ctx.ui.custom<void>(
        (modalTui, theme, keybindings, done) =>
          new KeysComponent(
            piGroups(keybindings),
            theme,
            () => done(),
            () => modalTui.requestRender(),
            modalTui.terminal.rows,
          ),
        { overlay: true, overlayOptions: MODAL_OVERLAY },
      );
    },
  });
}
