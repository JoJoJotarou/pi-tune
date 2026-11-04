import { keyHint, rawKeyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { joinHints } from "../shared/frame.ts";

/** What the editor holds. `/` and `!` only work at the start of the message, `@` anywhere. */
export type DraftState = "empty" | "text";

/** A draft sits in pi-tune's stash, or none is held. */
export type StashState = "none" | "held";

export interface HintState {
  draft: DraftState;
  /** An agent run is in flight. */
  running: boolean;
  /** The pi-tune editor is loaded, so `ctrl+s` works. */
  editor: boolean;
  stash: StashState;
  /** A btw side thread holds the drawer: it takes the input, so `/` and `!` do nothing. */
  btw: boolean;
}

export type Hint =
  | { key: string; label: string }
  | { binding: "tui.input.submit" | "app.message.followUp"; label: string };

export function hintFor(state: HintState): Hint[] {
  // A draft typed during a run is steer text: those two keys are the only ones that matter, and the row stays short.
  if (state.running && state.draft === "text") {
    return [
      { binding: "tui.input.submit", label: "steer" },
      { binding: "app.message.followUp", label: "follow-up" },
    ];
  }
  const hints: Hint[] = [];
  if (!state.btw && state.draft === "empty") hints.push({ key: "/", label: "commands" });
  hints.push({ key: "@", label: "files" });
  if (!state.btw && state.draft === "empty") hints.push({ key: "!", label: "shell" });
  // Nothing to stash, nothing to restore: leave the key out rather than advertise a no-op.
  if (state.editor) {
    if (state.draft === "text") hints.push({ key: "ctrl+s", label: "stash" });
    else if (state.stash === "held") hints.push({ key: "ctrl+s", label: "restore" });
  }
  return hints;
}

/** Pi's key hint style: key in `dim`, label in `muted`, joined with a dim separator. */
export function formatHints(hints: readonly Hint[], theme: Theme): string {
  if (hints.length === 0) return "";
  return joinHints(
    theme,
    hints.map((hint) => ("binding" in hint ? keyHint(hint.binding, hint.label) : rawKeyHint(hint.key, hint.label))),
  );
}
