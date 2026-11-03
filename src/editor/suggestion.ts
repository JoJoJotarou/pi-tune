import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Pi's editor content rows carry fragment-cache sentinels; the ghost text must live inside them. */
const GHOST_CLEAR = "\x1b_pi:fc\x07";
const GHOST_RESTORE = "\x1b_pi:/fc\x07";

/** How much of the last assistant reply feeds the suggestion request. */
const DIGEST_CHARS = 2000;

/**
 * Overlay the ghost suggestion onto an empty editor content row. The row keeps its markers and
 * its visible width, so neither the diff renderer nor the frame layout notices. Rows without the
 * marker pair (non-empty editors, other layouts) come back untouched.
 */
export function withGhostSuggestion(
  row: string,
  suggestion: string,
  style: (text: string) => string,
  width: number,
): string {
  const clear = row.indexOf(GHOST_CLEAR);
  const restore = row.indexOf(GHOST_RESTORE);
  if (suggestion === "" || clear < 0 || restore < clear + GHOST_CLEAR.length) return row;
  const text = truncateToWidth(suggestion, width, "").trimEnd();
  const textWidth = visibleWidth(text);
  const padding = " ".repeat(Math.max(0, width - textWidth));
  return row.slice(0, clear + GHOST_CLEAR.length) + style(text) + row.slice(restore).replace(/ +$/, "") + padding;
}

/** Reduce a model reply to one displayable line: no fences, quotes or wrapping. */
export function cleanSuggestion(raw: string, maxChars: number): string {
  const line = raw
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  if (line === undefined) return "";
  const unwrapped = line.replace(/^[`"'“”*-]+\s*/, "").replace(/[`"'“”*]+$/, "");
  return unwrapped.slice(0, maxChars).trim();
}

/** Tail of the assistant reply that the suggestion request sees. */
export function digestFromReply(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= DIGEST_CHARS ? trimmed : trimmed.slice(-DIGEST_CHARS);
}

export function buildSuggestionPrompt(digest: string, maxChars: number): string {
  return [
    "The user just received the assistant reply below.",
    `Suggest the single most useful next step for the user to type next.`,
    `Reply with ONLY that suggestion: one line, at most ${maxChars} characters, no quotes, no explanation.`,
    "",
    "Assistant reply:",
    digest === "" ? "(no text)" : digest,
  ].join("\n");
}
