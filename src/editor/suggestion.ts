import { type Api, clampThinkingLevel, type Model, type ThinkingLevel } from "@earendil-works/pi-ai";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { parseModelId, type SuggestSettings, type SuggestStyle } from "./suggest-settings.ts";

/** pi-tui's fake cursor marker (`FAKE_CURSOR_END` in its tui.d.ts, not a runtime export). */
const FAKE_CURSOR_END = "\x1b_pi:/fc\x07";

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

const CAREFUL_PROMPT: string = [
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

/** Offers a line whenever a natural next step exists; still never a question, filler, or the agent's voice. */
const EAGER_PROMPT: string = [
  "You predict the next line the USER will type into their coding agent.",
  "You see a transcript. The last line is from the agent.",
  "Write the most likely next user line. Write NONE only when no next line makes sense.",
  "",
  "Predict what they would type, not what you think they should do.",
  "If the agent asked something or offered a next step, answer it as the user would.",
  "If the work looks done, write the natural follow-up: verify it, commit it, or the next item.",
  "",
  "Never write a line the user already sent.",
  "Never write filler, a question, or agent voice.",
  "",
  "Use 2-12 words, in the user's language and style.",
  "Reply with only the line or NONE.",
].join("\n");

/** System prompt per suggestion style. */
export const SUGGEST_PROMPTS: Record<SuggestStyle, string> = { careful: CAREFUL_PROMPT, eager: EAGER_PROMPT };

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
 * fake cursor markers stays a single cell (the TUI inverts it as the block cursor), so the
 * suggestion goes after it and the row keeps its visible width. Rows without the marker pair
 * (non-empty editors, other layouts) come back untouched.
 */
export function withGhostSuggestion(
  row: string,
  suggestion: string,
  style: (text: string) => string,
  width: number,
): string {
  const restore = row.indexOf(FAKE_CURSOR_END);
  if (suggestion === "" || restore < 0) return row;
  const head = row.slice(0, restore + FAKE_CURSOR_END.length);
  const room = Math.max(0, width - visibleWidth(head));
  const text = truncateToWidth(suggestion, room, "").trimEnd();
  return head + style(text) + " ".repeat(Math.max(0, room - visibleWidth(text)));
}

export interface SuggestionEditor {
  getText(): string;
  getSuggestion(): string | undefined;
  setSuggestion(text: string | undefined): void;
}

export interface SuggestionTurn {
  role?: string;
  stopReason?: string;
  content?: Array<{ type?: string; text?: string }>;
}

export interface SuggestionRequest {
  model: unknown;
  systemPrompt: string;
  userMessage: string;
  signal: AbortSignal;
}

export type SuggestionComplete = (request: SuggestionRequest) => Promise<string>;

export interface SuggestionOptions {
  complete: SuggestionComplete;
  findModel(provider: string, id: string): unknown | undefined;
  sessionModel(): unknown | undefined;
  collectTurns(): TranscriptTurn[];
  cwd(): string;
  editor(): SuggestionEditor | undefined;
  notify(message: string, level: "warning"): void;
  maxChars?: number;
  timeoutMs?: number;
}

const SUGGEST_CHARS = 80;
/** Reasoning models can take tens of seconds even at their lowest level; past this the request counts as failed. */
const SUGGEST_TIMEOUT_MS = 45_000;

/** The lowest thinking level the model offers; providers default reasoning models to more (OpenAI: medium). */
export function suggestReasoning(model: Model<Api>): ThinkingLevel | undefined {
  if (!model.reasoning) return undefined;
  const level = clampThinkingLevel(model, "minimal");
  return level === "off" ? undefined : level;
}
/** After this many shown suggestions in a row go unused, only every `BACKOFF_EVERY`-th run asks. */
const BACKOFF_AFTER = 10;
const BACKOFF_EVERY = 3;

/** One suggestion request per run, aborted by the next run or session change. */
export class Suggestion {
  private readonly options: SuggestionOptions;
  private enabled = false;
  private style: SuggestStyle = "careful";
  private overrideModel: unknown;
  private sessionModelValue: unknown;
  private invalidModel = false;
  private failed = false;
  private runActive = false;
  private requestedThisRun = false;
  private lastStopReason: string | undefined;
  private shown = false;
  private unusedStreak = 0;
  private skippedRuns = 0;
  private abort: AbortController | undefined;

  constructor(options: SuggestionOptions) {
    this.options = options;
  }

  startSession(): void {
    this.discard();
    this.enabled = false;
    this.overrideModel = undefined;
    this.sessionModelValue = this.options.sessionModel();
    this.invalidModel = false;
    this.failed = false;
    this.runActive = false;
    this.requestedThisRun = false;
  }

  /** Apply the settings the user just saved; an unknown model warns and leaves suggestions off. */
  applySettings(settings: SuggestSettings): void {
    this.enabled = settings.enabled;
    this.style = settings.style ?? "careful";
    this.overrideModel = undefined;
    this.invalidModel = false;
    // A new choice is a fresh try, even after a failed request.
    this.failed = false;
    if (!settings.enabled) {
      this.discard();
      return;
    }
    const setting = settings.model;
    if (setting === undefined || setting === "") return;
    const parsed = parseModelId(setting);
    const model = parsed === undefined ? undefined : this.options.findModel(parsed.provider, parsed.id);
    if (model === undefined) {
      this.enabled = false;
      this.invalidModel = true;
      this.options.notify(`Next-step suggestion model "${setting}" is not a known provider/model.`, "warning");
      return;
    }
    this.overrideModel = model;
  }

  setSessionModel(model: unknown): void {
    this.sessionModelValue = model;
  }

  agentStart(): void {
    this.discard();
    this.requestedThisRun = false;
    this.lastStopReason = undefined;
    this.runActive = true;
  }

  /** The user took the suggestion with tab. */
  accepted(): void {
    this.shown = false;
    this.unusedStreak = 0;
    this.skippedRuns = 0;
  }

  async turnEnd(message: SuggestionTurn, toolResultCount: number): Promise<void> {
    if (message.role === "assistant") this.lastStopReason = message.stopReason;
    if (message.role !== "assistant" || message.stopReason !== "stop" || toolResultCount > 0) return;
    if (this.requestedThisRun || !this.runActive) return;
    const reply = (message.content ?? [])
      .filter(
        (block): block is { type: "text"; text: string } => block.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("\n");
    await this.request(reply);
  }

  async agentSettled(aborted: boolean): Promise<void> {
    // After an error the same provider would most likely fail again; a length cut still gets "continue".
    if (!aborted && this.runActive && !this.requestedThisRun && this.lastStopReason !== "error") await this.request();
    this.runActive = false;
  }

  discard(): void {
    if (this.shown) {
      this.shown = false;
      this.unusedStreak++;
    }
    this.abort?.abort();
    this.abort = undefined;
    const editor = this.options.editor();
    if (editor?.getSuggestion() !== undefined) editor.setSuggestion(undefined);
  }

  private async request(concludingReply?: string): Promise<void> {
    const editor = this.options.editor();
    if (!this.enabled || this.invalidModel || this.failed || editor === undefined) return;
    const model = this.overrideModel ?? this.sessionModelValue;
    if (model === undefined) return;
    if (this.unusedStreak >= BACKOFF_AFTER) {
      this.requestedThisRun = true;
      if (++this.skippedRuns < BACKOFF_EVERY) return;
      this.skippedRuns = 0;
    }
    const turns = this.options.collectTurns();
    const reply = concludingReply?.trim() ?? "";
    if (reply !== "") {
      const last = turns[turns.length - 1];
      if (last?.role !== "assistant" || last.text.trim() !== reply) {
        turns.push({ role: "assistant", text: reply });
      }
    }
    const transcript = buildTranscript(turns);
    if (transcript === undefined) return;
    this.requestedThisRun = true;
    const controller = new AbortController();
    this.abort = controller;
    const timeoutMs = this.options.timeoutMs ?? SUGGEST_TIMEOUT_MS;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const text = await this.options.complete({
        model,
        systemPrompt: SUGGEST_PROMPTS[this.style],
        userMessage: buildSuggestionUserMessage(this.options.cwd(), transcript),
        signal: controller.signal,
      });
      if (timedOut) throw new Error("timed out");
      if (controller.signal.aborted) return;
      const suggestion = cleanSuggestion(text, this.options.maxChars ?? SUGGEST_CHARS);
      // Keep the reply even when the editor has text: the editor hides it until the text is cleared.
      if (suggestion !== "") {
        editor.setSuggestion(suggestion);
        this.shown = true;
      }
    } catch (error) {
      if (!timedOut && (controller.signal.aborted || (error instanceof Error && error.name === "AbortError"))) return;
      this.failed = true;
      const reason = timedOut
        ? `timed out after ${timeoutMs / 1000} s`
        : error instanceof Error
          ? error.message
          : String(error);
      this.options.notify(`Next-step suggestion failed: ${reason}`, "warning");
    } finally {
      clearTimeout(timer);
      if (this.abort === controller) this.abort = undefined;
    }
  }
}

interface SessionEntryLike {
  message?: { role?: string; content?: string | Array<{ type?: string; text?: string }> };
}

/** Turns from the session's current branch; abandoned branches stay out of the model request. */
export function collectSessionTurns(session: { getBranch(): readonly unknown[] }): TranscriptTurn[] {
  return collectTranscriptTurns(session.getBranch());
}

/** User and assistant text from the current branch, oldest first; everything else is skipped. */
export function collectTranscriptTurns(entries: readonly unknown[]): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const entry of entries) {
    const message = (entry as SessionEntryLike).message;
    if (!message) continue;
    const role = message.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = message.content ?? [];
    const text =
      typeof content === "string"
        ? content
        : content
            .filter((block): block is { type: "text"; text: string } => block.type === "text")
            .map((block) => block.text)
            .join("\n");
    if (text.trim() !== "") turns.push({ role, text });
  }
  return turns;
}
