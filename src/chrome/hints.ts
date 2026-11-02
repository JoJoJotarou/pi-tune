import { keyHint, rawKeyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { joinHints } from "../shared/frame.ts";

export type HintState = "idle" | "busy-empty" | "busy-typing";

/** Which optional extensions are loaded, so their keys are only advertised when they work. */
export interface HintAvailability {
  stash: boolean;
}

export type Hint = { key: string; label: string } | { binding: "app.message.followUp"; label: string };

export function hintFor(state: HintState, available: HintAvailability): Hint[] {
  if (state === "busy-empty") return [];
  if (state === "busy-typing") {
    return [
      { key: "enter", label: "steer" },
      { binding: "app.message.followUp", label: "follow-up" },
    ];
  }
  const hints: Hint[] = [
    { key: "/", label: "commands" },
    { key: "@", label: "files" },
    { key: "!", label: "shell" },
  ];
  if (available.stash) hints.push({ key: "ctrl+s", label: "stash" });
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
