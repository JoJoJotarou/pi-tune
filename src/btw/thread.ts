import type { AssistantMessage, Message } from "@earendil-works/pi-ai";

export const BTW_ENTRY_TYPE = "pi-tune-btw";

/**
 * One `you` / `btw` exchange. `text` and `message` are stored exactly as they went over the wire:
 * replaying a thread must reproduce the same bytes, or the provider's prefix cache misses after a
 * reload. Never rebuild them from the visible question and answer.
 */
export interface BtwTurn {
  /** Exactly the user text that was sent for this turn. */
  text: string;
  /** The question without the wrapper blocks, for display. */
  question: string;
  /** The assistant message as returned, for display and replay. */
  message: AssistantMessage;
  askedAt: number;
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
  "Answer directly and in plain text. The user may ask follow-ups in this thread.",
  "Do not call tools, and do not start work of your own or continue the main session's task unless the user asks.",
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

/** Builds the exact user text for one turn. Stored once and reused by replay. */
export function composeTurnText(question: string, options: { addendum?: string; notice?: string } = {}): string {
  return [options.addendum, options.notice, question]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");
}

/** The seeded history for a thread: stored user text and the stored assistant message, unchanged. */
export function threadMessages(thread: BtwThread): Message[] {
  const messages: Message[] = [];
  for (const turn of thread.turns) {
    messages.push({ role: "user", content: [{ type: "text", text: turn.text }], timestamp: turn.askedAt });
    messages.push(turn.message);
  }
  return messages;
}

/** The visible answer: every text block of the assistant message, in order. */
export function turnAnswer(turn: BtwTurn): string {
  return turn.message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export function countUserTurns(messages: readonly { role: string }[]): number {
  return messages.filter((message) => message.role === "user").length;
}
