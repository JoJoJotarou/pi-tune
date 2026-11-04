import type { Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  cacheHitPercent?: number;
}

export function addUsage(totals: UsageTotals, usage: Usage): void {
  totals.input += usage.input;
  totals.output += usage.output;
  totals.cacheRead += usage.cacheRead;
  totals.cacheWrite += usage.cacheWrite;
  totals.cost += usage.cost.total;
}

/** Pi's footer totals: every usage record in the session, plus the latest assistant cache hit rate. */
export function sessionUsage(entries: readonly SessionEntry[]): UsageTotals {
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
