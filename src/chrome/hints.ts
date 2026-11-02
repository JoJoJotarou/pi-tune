export type HintState = "idle" | "running";

export interface HintKeys {
  interrupt: string;
  followUp: string;
}

/** Which optional extensions are loaded, so their keys are only advertised when they work. */
export interface HintAvailability {
  stash: boolean;
  view: boolean;
}

export function hintFor(state: HintState, keys: HintKeys, available: HintAvailability): string {
  const hints: string[] = [];
  if (state === "idle") {
    hints.push("/ commands", "@ files", "! shell");
    if (available.stash) hints.push("ctrl+s stash");
  } else {
    hints.push(`${keys.interrupt} stop`, "enter steer", `${keys.followUp} queue`);
  }
  if (available.view) hints.push("alt+o view");
  return hints.join(" · ");
}
