import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Pi's editor content rows carry fragment-cache sentinels around the cursor cell. */
const GHOST_CLEAR = "\x1b_pi:fc\x07";
const GHOST_RESTORE = "\x1b_pi:/fc\x07";

/**
 * Compact transcript sent to the suggestion model, newest message last. Grok Build's
 * next-prompt suggestion (xai-org/grok-build, session/helpers/prompt_suggest.rs) uses the
 * same shape: a role-labeled transcript of user and assistant text, walked backward under a
 * character budget, with the newest assistant reply getting the remaining budget.
 */
const TRANSCRIPT_BUDGET_CHARS = 8000;
/** Per-message cap; long logs and diffs carry little signal for next-prompt prediction. */
const MESSAGE_CAP_CHARS = 1000;

export interface TranscriptTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * Flatten the conversation into a role-labeled transcript, walking backward from the newest
 * turn until the character budget is exhausted. The newest assistant reply keeps the whole
 * remaining budget (it carries the strongest signal); earlier messages are capped. Returns
 * undefined when there is no assistant reply to predict from.
 */
export function buildTranscript(turns: readonly TranscriptTurn[]): string | undefined {
  const lines: string[] = [];
  let used = 0;
  let sawAssistant = false;
  for (const turn of [...turns].reverse()) {
    const text = turn.text.trim();
    if (text === "") continue;
    if (!sawAssistant && turn.role !== "assistant") continue;
    const cap = !sawAssistant ? TRANSCRIPT_BUDGET_CHARS - used - "Agent: ".length : MESSAGE_CAP_CHARS;
    const body = text.length > cap ? `${text.slice(0, Math.max(0, cap))}\n…` : text;
    const line = `${turn.role === "user" ? "User" : "Agent"}: ${body}`;
    if (used + line.length > TRANSCRIPT_BUDGET_CHARS && lines.length > 0) break;
    used += line.length;
    lines.push(line);
    if (turn.role === "assistant") sawAssistant = true;
  }
  if (!sawAssistant || lines.length === 0) return undefined;
  return lines.reverse().join("\n\n");
}

export const SUGGEST_SYSTEM_PROMPT: string = [
  "You predict the next line the USER will type into their coding agent.",
  "You see a transcript. The last line is from the agent.",
  "Write only that next user line, or NONE.",
  "",
  "Predict what they would type, not what you think they should do.",
  "A wrong line is worse than NONE.",
  "Write NONE if the next line is long, new, or not obvious.",
  "Write NONE after an error or a misunderstanding.",
  "",
  "Never write a line the user already sent.",
  "Never write filler, a question, or agent voice.",
  "",
  "If you write a line, use 2-12 words in their style.",
  "Reply with only the line or NONE.",
].join("\n");

export function buildSuggestionUserMessage(cwd: string, transcript: string): string {
  return `CWD: ${cwd}\n\nTranscript:\n\n${transcript}\n\nPredict the user's next message. Reply with ONLY the suggestion text.`;
}

/** Reduce a model reply to one displayable line; silence tokens mean "no suggestion". */
export function cleanSuggestion(raw: string, maxChars: number): string {
  const line = raw
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  if (line === undefined) return "";
  const unwrapped = line
    .replace(/^[`"'“”*-]+\s*/, "")
    .replace(/[`"'“”*]+$/, "")
    .trim();
  const lowered = unwrapped.toLowerCase();
  const meta = ["none", "n/a", "no suggestion", "nothing", "silence", "null"];
  if (meta.some((word) => lowered === word || lowered.startsWith(`${word}.`))) {
    return "";
  }
  return unwrapped.slice(0, maxChars).trim();
}

/** Overlay the ghost suggestion onto an empty editor content row. The cursor cell between Pi's
 * fragment-cache markers stays a single cell (the TUI inverts it as the block cursor), so the
 * suggestion goes after it and the row keeps its visible width. Rows without the marker pair
 * (non-empty editors, other layouts) come back untouched.
 */
export function withGhostSuggestion(
  row: string,
  suggestion: string,
  style: (text: string) => string,
  width: number,
): string {
  const restore = row.indexOf(GHOST_RESTORE);
  if (suggestion === "" || restore < 0) return row;
  const text = truncateToWidth(suggestion, Math.max(0, width - 1), "").trimEnd();
  const padding = " ".repeat(Math.max(0, width - 1 - visibleWidth(text)));
  return row.slice(0, restore + GHOST_RESTORE.length) + style(text) + padding;
}
