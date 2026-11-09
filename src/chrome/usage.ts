import type { Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  /** Assistant messages that reported usage: one API request each. */
  requests: number;
  /** The latest request on its own, which the per-turn pill draws. */
  last?: { output: number; cacheHitPercent: number };
}

export function addUsage(totals: UsageTotals, usage: Usage): void {
  totals.input += usage.input;
  totals.output += usage.output;
  totals.cacheRead += usage.cacheRead;
  totals.cacheWrite += usage.cacheWrite;
  totals.cost += usage.cost.total;
}

/** Pi's footer totals: every usage record in the session, plus the latest request on its own. */
export function sessionUsage(entries: readonly SessionEntry[]): UsageTotals {
  const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, requests: 0 };
  for (const entry of entries) {
    if (entry.type === "usage") {
      addUsage(totals, entry.usage);
    } else if (entry.type === "message") {
      const message = entry.message;
      if (message.role === "assistant") {
        addUsage(totals, message.usage);
        // A `usage` entry can bill work without a message (a cache warm), so only messages count as requests.
        totals.requests += 1;
        const prompt = message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
        totals.last = {
          output: message.usage.output,
          cacheHitPercent: prompt > 0 ? (message.usage.cacheRead / prompt) * 100 : 0,
        };
      } else if (message.role === "toolResult" && message.usage) {
        addUsage(totals, message.usage);
      }
    } else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
      addUsage(totals, entry.usage);
    }
  }
  return totals;
}
