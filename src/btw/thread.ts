import type { AssistantMessage, Message, ToolResultMessage } from "@earendil-works/pi-ai";

export const BTW_ENTRY_TYPE = "pi-tune-btw";

/**
 * One `you` / `btw` exchange. `text` and `messages` are stored exactly as they went over the wire:
 * replaying a thread must reproduce the same bytes, or the provider's prefix cache misses after a
 * reload. Never rebuild them from the visible question and answer.
 */
export interface BtwTurn {
  /** Exactly the user text that was sent for this turn. */
  text: string;
  /** The question without the wrapper blocks, for display. */
  question: string;
  /** Every message the turn produced, tool calls and their results included; the last one is the answer. */
  messages: (AssistantMessage | ToolResultMessage)[];
  askedAt: number;
  /** From asking to the last streamed token. */
  durationMs: number;
  /** Tool calls the rules refused, named the way a rule would name them. */
  denied: string[];
  /** The tool rules this turn's text told the model, when it told them; a later turn repeats them only on change. */
  announcedTools?: string;
}

/** The answer: the turn's last assistant message. */
export function turnReply(turn: BtwTurn): AssistantMessage {
  for (let index = turn.messages.length - 1; index >= 0; index--) {
    const message = turn.messages[index];
    if (message.role === "assistant") return message;
  }
  throw new Error("A btw turn was stored without an answer.");
}

export interface BtwThread {
  id: string;
  /** Main-session entry id the snapshot stops at. */
  anchorEntryId: string;
  /** User messages the main session had when this thread started. */
  anchorTurns: number;
  turns: BtwTurn[];
}

/**
 * Runs once, on the first turn of a thread. It says what a side thread is, not what to answer, so
 * it can stay out of the system prompt and leave the parent's prefix untouched.
 */
export const SIDE_THREAD_ADDENDUM = [
  "<btw_side_thread>",
  "This is a side thread with the user, running alongside their main session.",
  "The conversation before this message is the main session as it stood when this thread started;",
  "main-session turns from after that point are not visible to you.",
  "Answer directly. The user may ask follow-ups in this thread.",
  "Do not change files, and do not start work of your own or continue the main session's task unless the user asks.",
  "</btw_side_thread>",
].join("\n");

/** Warns the model about main-session turns it cannot see. Only ever sent with a new turn. */
export function staleNotice(anchorTurns: number, currentTurns: number): string | undefined {
  const behind = currentTurns - anchorTurns;
  if (behind <= 0) return undefined;
  return [
    "<btw_stale_context>",
    `This thread is anchored at main turn ${anchorTurns}; the main session is now at turn ${currentTurns}.`,
    `${behind} main-session turn${behind === 1 ? "" : "s"} happened after this thread started and are not in your context.`,
    "Do not assume what they contain.",
    "</btw_stale_context>",
  ].join("\n");
}

/**
 * The tool calls this thread runs. Every tool stays declared, so the request prefix matches the main session; this
 * says which of them work, so the model does not find out one refused call at a time.
 */
export function toolsNotice(allowed: readonly string[], denied: readonly string[], changed: boolean): string {
  return [
    "<btw_tools>",
    ...(changed ? ["The tool rules of this thread changed."] : []),
    allowed.length > 0
      ? `Only these tool calls run in this thread: ${allowed.join(", ")}.`
      : "No tool calls run in this thread.",
    ...(allowed.some((call) => call.startsWith("bash("))
      ? ["A rule such as bash(git log *) allows the bash commands that start that way."]
      : []),
    ...(denied.length > 0 ? [`Never run: ${denied.join(", ")}.`] : []),
    "Any other call is refused, so do not try it; answer from what these calls can reach.",
    "</btw_tools>",
  ].join("\n");
}

/** Builds the exact user text for one turn. Stored once and reused by replay. */
export function composeTurnText(
  question: string,
  options: { addendum?: string; tools?: string; notice?: string } = {},
): string {
  return [options.addendum, options.tools, options.notice, question]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");
}

/** The seeded history for a thread: stored user text and every stored message of each turn, unchanged. */
export function threadMessages(thread: BtwThread): Message[] {
  const messages: Message[] = [];
  for (const turn of thread.turns) {
    messages.push({ role: "user", content: [{ type: "text", text: turn.text }], timestamp: turn.askedAt });
    messages.push(...turn.messages);
  }
  return messages;
}

/** The visible answer: every text block of the assistant message, in order. */
export function messageText(message: AssistantMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/** Everything the agent added after the last question: tool calls, their results, and the answer last. */
export function producedMessages(messages: readonly { role: string }[]): (AssistantMessage | ToolResultMessage)[] {
  let start = messages.length;
  while (start > 0 && messages[start - 1].role !== "user") start--;
  return messages.slice(start) as (AssistantMessage | ToolResultMessage)[];
}

export function countUserTurns(messages: readonly { role: string }[]): number {
  return messages.filter((message) => message.role === "user").length;
}

/**
 * One saved turn: the turn and the thread it belongs to, without the thread's other turns. Saving each turn once
 * keeps the session file growing by what a turn adds, instead of by every thread again on every answer.
 */
export interface StoredTurn {
  thread: Pick<BtwThread, "id" | "anchorEntryId" | "anchorTurns">;
  turn: BtwTurn;
}

export function storedTurn(thread: BtwThread, turn: BtwTurn): StoredTurn {
  return { thread: { id: thread.id, anchorEntryId: thread.anchorEntryId, anchorTurns: thread.anchorTurns }, turn };
}

function isStoredTurn(value: unknown): value is StoredTurn {
  const stored = value as Partial<StoredTurn> | null | undefined;
  const turn = stored?.turn as Partial<BtwTurn> | undefined;
  return (
    typeof stored?.thread?.id === "string" &&
    typeof stored.thread.anchorEntryId === "string" &&
    typeof stored.thread.anchorTurns === "number" &&
    typeof turn?.text === "string" &&
    typeof turn.question === "string" &&
    Array.isArray(turn.messages) &&
    Array.isArray(turn.denied) &&
    typeof turn.askedAt === "number" &&
    typeof turn.durationMs === "number"
  );
}

/** The threads saved turn by turn, in the order their first turns were saved; entries in another shape are skipped. */
export function foldThreads(entries: readonly unknown[]): { threads: BtwThread[]; skipped: number } {
  const threads: BtwThread[] = [];
  let skipped = 0;
  for (const entry of entries) {
    if (!isStoredTurn(entry)) {
      skipped++;
      continue;
    }
    let thread = threads.find((known) => known.id === entry.thread.id);
    if (!thread) {
      thread = { ...entry.thread, turns: [] };
      threads.push(thread);
    }
    thread.turns.push(entry.turn);
  }
  return { threads, skipped };
}
