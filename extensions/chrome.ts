import { homedir } from "node:os";
import { sep } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { type ExtensionAPI, keyText, VERSION } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { type FooterParts, footerLine } from "../src/chrome/footer.ts";
import { headerLine } from "../src/chrome/header.ts";
import { hintFor } from "../src/chrome/hints.ts";

function displayPath(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";
  if (cwd.startsWith(`${home}${sep}`)) return `~${cwd.slice(home.length)}`;
  return cwd;
}

export default function (pi: ExtensionAPI) {
  let running = false;
  let stashReady = false;
  let tui: TUI | undefined;

  pi.events.on("pi-tune:editor-ready", () => {
    stashReady = true;
    tui?.requestRender();
  });

  pi.on("agent_start", () => {
    running = true;
    tui?.requestRender();
  });

  pi.on("agent_settled", () => {
    running = false;
    tui?.requestRender();
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const path = displayPath(ctx.cwd);

    ctx.ui.setHeader((_headerTui, theme) => ({
      render(width: number): string[] {
        return [headerLine({ version: VERSION, cwd: path }, width, theme)];
      },
      invalidate() {},
    }));

    ctx.ui.setFooter((footerTui, theme, footerData) => {
      tui = footerTui;
      const unsubscribe = footerData.onBranchChange(() => footerTui.requestRender());
      return {
        render(width: number): string[] {
          let input = 0;
          let output = 0;
          let cacheRead = 0;
          let cost = 0;
          for (const entry of ctx.sessionManager.getEntries()) {
            if (entry.type !== "message" || entry.message.role !== "assistant") continue;
            const usage = (entry.message as AssistantMessage).usage;
            input += usage.input;
            output += usage.output;
            cacheRead += usage.cacheRead;
            cost += usage.cost.total;
          }

          const totalInput = input + cacheRead;
          const viewReady = pi
            .getCommands()
            .some((command) => command.name === "view" && command.source === "extension");
          const parts: FooterParts = {
            path,
            branch: footerData.getGitBranch() ?? undefined,
            hints: hintFor(
              running ? "running" : "idle",
              {
                interrupt: keyText("app.interrupt"),
                followUp: keyText("app.message.followUp"),
              },
              { stash: stashReady, view: viewReady },
            ),
            tokens: { input, output },
            cachePercent: totalInput > 0 ? (cacheRead / totalInput) * 100 : null,
            cost,
            ctxPercent: ctx.getContextUsage()?.percent ?? 0,
            statuses: Array.from(footerData.getExtensionStatuses().values()),
          };
          return footerLine(parts, width, theme);
        },
        invalidate() {},
        dispose: unsubscribe,
      };
    });
  });
}
