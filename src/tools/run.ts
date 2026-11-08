/**
 * Grouping of consecutive read-only tool calls into one card: the head draws the group header
 * (`Read 2 files, Searched 1 pattern   0.2s`), the members draw their own rows inside the same card.
 *
 * The plan is derived from the session branch (pure `planRuns`) and decides roles; per-call facts
 * are recorded by each row's own renderers and feed the header's status and clock. The card caches
 * on the values it draws, so a plan or fact change needs no cross-component invalidation.
 */
import { plural } from "./search.ts";

interface RunMember {
  /** The `toolCallId` of the assistant message's tool call block. */
  id: string;
  name: string;
}

/** One group of consecutive mergeable calls, in transcript order; the head is the first member. */
export interface Run {
  headId: string;
  members: RunMember[];
}

/** Status of one call as its own renderer sees it; queued is planned but not executing yet. */
type RunFactStatus = "queued" | "running" | "success" | "error";

/** What one row reports about itself while it renders. */
interface RunFacts {
  status: RunFactStatus;
  durationMs?: number;
  /** When the call started executing; the group clocks from the first start to the last end. */
  startedAt?: number;
}

/** Everything the head card draws about a run, derived in one pass over its facts. */
export interface RunView {
  members: readonly RunMember[];
  statuses: RunFactStatus[];
  /** The user's choice, or the run's own: open until every call has a result. */
  open: boolean;
  /** The wall clock of the run once every call has a result; undefined while it runs. */
  durationMs?: number;
}

/** The read-only tools whose rows pi-tune draws; only these calls can join a run. */
export const MERGEABLE_TOOLS = new Set(["read", "grep", "find", "ls"]);

/** The shape `planRuns` reads from a session entry; structural, so tests and events can feed it. */
export interface PlanEntry {
  type: string;
  message?: { role: string; content?: string | readonly { type: string; id?: string; name?: string }[] };
}

/**
 * Consecutive mergeable calls of the branch, in transcript order, as runs of two or more. A run
 * breaks at anything a renderer draws between two tool rows: user and assistant text, thinking
 * blocks, non-mergeable tools, and non-message entries such as compaction summaries. A call id
 * seen twice (the live copy of a message that already landed in the branch) counts once.
 */
export function planRuns(entries: readonly PlanEntry[]): Run[] {
  const runs: Run[] = [];
  const seen = new Set<string>();
  let current: RunMember[] = [];
  const flush = (): void => {
    if (current.length >= 2) runs.push({ headId: current[0].id, members: current });
    current = [];
  };
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "assistant") {
      flush();
      continue;
    }
    const content = entry.message.content;
    if (content === undefined || typeof content === "string") {
      flush();
      continue;
    }
    for (const block of content) {
      if (
        block.type === "toolCall" &&
        block.id !== undefined &&
        block.name !== undefined &&
        MERGEABLE_TOOLS.has(block.name)
      ) {
        if (seen.has(block.id)) continue;
        seen.add(block.id);
        current.push({ id: block.id, name: block.name });
      } else {
        flush();
      }
    }
  }
  flush();
  return runs;
}

let heads = new Map<string, string>();
let groups = new Map<string, Run>();
let facts = new Map<string, RunFacts>();
let rows = new Map<string, (width: number) => string[]>();
let bodies = new Map<string, (width: number) => string[]>();
let labels = new Map<string, string>();
let headExpanded = new Map<string, boolean>();
let callOpen = new Map<string, boolean>();

/** Renders one call's own header line; the open group card draws its members through this. */
export function registerRow(toolCallId: string, render: (width: number) => string[]): void {
  rows.set(toolCallId, render);
}

/** Renders one call's result body, already expanded; the open group card draws opened bodies through this. */
export function registerBody(toolCallId: string, render: (width: number) => string[]): void {
  bodies.set(toolCallId, render);
}

/** What the call is about (`src/a.ts`, `"TODO" in src`), for naming it in the group header. */
export function registerLabel(toolCallId: string, label: string): void {
  labels.set(toolCallId, label);
}

export function memberRow(toolCallId: string, width: number): string[] {
  return rows.get(toolCallId)?.(width) ?? [];
}

export function memberBody(toolCallId: string, width: number): string[] {
  return bodies.get(toolCallId)?.(width) ?? [];
}

export function memberLabel(toolCallId: string): string | undefined {
  return labels.get(toolCallId);
}

/** Installs a new plan; an unchanged plan keeps the current maps and state untouched. */
export function setRunPlan(runs: readonly Run[]): void {
  const nextHeads = new Map<string, string>();
  const nextGroups = new Map<string, Run>();
  for (const run of runs) {
    nextGroups.set(run.headId, run);
    for (const member of run.members) nextHeads.set(member.id, run.headId);
  }
  if (sameHeads(heads, nextHeads)) return;
  heads = nextHeads;
  groups = nextGroups;
}

function sameHeads(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, headId] of b) if (a.get(id) !== headId) return false;
  return true;
}

/** Drops plan, facts, registrations, and click state; called on session start and shutdown. */
export function clearRuns(): void {
  heads = new Map();
  groups = new Map();
  facts = new Map();
  rows = new Map();
  bodies = new Map();
  labels = new Map();
  headExpanded = new Map();
  callOpen = new Map();
}

/** The head of the run a call belongs to; `undefined` when it stands alone or the transcript is expanded. */
export function runHead(toolCallId: string, expanded: boolean): string | undefined {
  // ctrl+o expands every call on its own row; no group survives it.
  if (expanded) return undefined;
  return heads.get(toolCallId);
}

/** What the head draws, or `undefined` for an id that is not a run head. */
export function runView(headId: string): RunView | undefined {
  const run = groups.get(headId);
  if (run === undefined) return undefined;
  const statuses = run.members.map((member) => facts.get(member.id)?.status ?? "queued");
  return {
    members: run.members,
    statuses,
    open: headExpanded.get(headId) ?? !statuses.every(settled),
    durationMs: runDuration(run.members, statuses),
  };
}

function settled(status: RunFactStatus): boolean {
  return status === "success" || status === "error";
}

/** From the first member's start to the last member's end; resumed facts carry no start to sum instead. */
function runDuration(members: readonly RunMember[], statuses: readonly RunFactStatus[]): number | undefined {
  if (!statuses.every(settled)) return undefined;
  const memberFacts = members.map((member) => facts.get(member.id));

  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  let spans = true;
  for (const fact of memberFacts) {
    if (fact?.startedAt === undefined || fact.durationMs === undefined) {
      spans = false;
      break;
    }
    start = Math.min(start, fact.startedAt);
    end = Math.max(end, fact.startedAt + fact.durationMs);
  }
  if (spans) {
    const ms = end - start;
    return ms > 0 ? ms : undefined;
  }

  let total = 0;
  for (const fact of memberFacts) {
    if (fact?.durationMs === undefined) return undefined;
    total += fact.durationMs;
  }
  return total > 0 ? total : undefined;
}

interface VerbKind {
  past: string;
  present: string;
  noun: string;
}

const VERBS: Record<string, VerbKind> = {
  read: { past: "Read", present: "Reading", noun: "file" },
  grep: { past: "Searched", present: "Searching", noun: "pattern" },
  find: { past: "Searched", present: "Searching", noun: "pattern" },
  ls: { past: "Listed", present: "Listing", noun: "dir" },
};
const OTHER_TOOL: VerbKind = { past: "Ran", present: "Running", noun: "tool" };

/** The group header's counts by what the calls did, in first-appearance order: `Read 2 files, Searched 1 pattern`. */
export function runCountLabel(names: readonly string[], running: boolean): string {
  const buckets = new Map<string, { kind: VerbKind; count: number }>();
  for (const name of names) {
    const kind = VERBS[name] ?? OTHER_TOOL;
    const bucket = buckets.get(kind.noun) ?? { kind, count: 0 };
    bucket.count += 1;
    buckets.set(kind.noun, bucket);
  }
  return [...buckets.values()]
    .map(({ kind, count }) => `${running ? kind.present : kind.past} ${plural(count, kind.noun)}`)
    .join(", ");
}

/** Records that the head row expanded or folded the whole run. */
export function setHeadExpanded(headId: string, expanded: boolean): void {
  headExpanded.set(headId, expanded);
}

/** Whether one call's result body is open inside an expanded group. */
export function callExpanded(toolCallId: string): boolean {
  return callOpen.get(toolCallId) === true;
}

/** Toggles one call's body inside an expanded group; the group card redraws. */
export function toggleCallExpanded(toolCallId: string): void {
  callOpen.set(toolCallId, !callExpanded(toolCallId));
}

function sameFacts(a: RunFacts, b: RunFacts): boolean {
  return a.status === b.status && a.durationMs === b.durationMs && a.startedAt === b.startedAt;
}

/**
 * Records one row's facts. An omitted duration keeps its earlier value, so a later render cannot
 * erase a richer one.
 */
export function recordFacts(toolCallId: string, next: RunFacts): void {
  const previous = facts.get(toolCallId);
  const merged: RunFacts = {
    status: next.status,
    durationMs: next.durationMs ?? previous?.durationMs,
    // Keep the first execution start: the group's wall clock runs from it.
    startedAt: next.status === "running" ? (previous?.startedAt ?? Date.now()) : previous?.startedAt,
  };
  if (previous !== undefined && sameFacts(previous, merged)) return;
  facts.set(toolCallId, merged);
}
