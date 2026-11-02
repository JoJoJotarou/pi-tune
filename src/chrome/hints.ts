export type HintState = "idle" | "running";

export interface HintKeys {
  interrupt: string;
  followUp: string;
}

export function hintFor(state: HintState, keys: HintKeys): string {
  if (state === "idle") return "/ commands · @ files · ! shell · ctrl+s stash · alt+o view";
  return `${keys.interrupt} stop · enter steer · ${keys.followUp} queue · alt+o view`;
}
