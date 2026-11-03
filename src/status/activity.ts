import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatDuration } from "../shared/format.ts";

/** Runs at least this long leave a done title, so a glance at the tab shows the work finished. */
const DONE_TITLE_MS = 15_000;
const COLUMN_GAP = " ";

export type ActivityPhase = "working" | "thinking" | "responding" | "tool";

export interface ActivityState {
  running: boolean;
  /** When `agent_start` fired; the only timer on the status line. */
  startedAt: number;
  phase: ActivityPhase;
  /** Ids of the running tools; the working message never names them. */
  tools: string[];
}

export const initialState: ActivityState = {
  running: false,
  startedAt: 0,
  phase: "working",
  tools: [],
};

export type ActivityEvent =
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "message_update"; kind: "thinking" | "text" }
  | { type: "tool_execution_start"; id: string }
  | { type: "tool_execution_end"; id: string }
  | { type: "agent_settled" };

export function reduce(state: ActivityState, event: ActivityEvent, now: number): ActivityState {
  switch (event.type) {
    case "agent_start":
      return {
        running: true,
        startedAt: now,
        phase: "working",
        tools: [],
      };
    case "turn_start":
      return { ...state, phase: "working", tools: [] };
    case "message_update":
      return { ...state, phase: event.kind === "text" ? "responding" : "thinking" };
    case "tool_execution_start": {
      const tools = [...state.tools.filter((id) => id !== event.id), event.id];
      return { ...state, phase: "tool", tools };
    }
    case "tool_execution_end": {
      const tools = state.tools.filter((id) => id !== event.id);
      return { ...state, phase: tools.length === 0 ? "working" : "tool", tools };
    }
    case "agent_settled":
      return { ...state, running: false, tools: [] };
  }
}

export interface DescribeOptions {
  /** Available columns for the whole line. */
  width: number;
  /** Key that stops the run, from `keyText("app.interrupt")`. */
  interruptKey: string;
  theme: Theme;
}

/**
 * One line for `ctx.ui.setWorkingMessage()`, or `""` when no run is active.
 * Same colors in every phase: phase `text`, total and hint `dim`.
 */
export function describe(state: ActivityState, now: number, options: DescribeOptions): string {
  if (!state.running) return "";
  const { width, interruptKey, theme } = options;
  if (width <= 0) return "";

  // Waiting for the model and running tools both read as Pi's own "Working"; only the model's own phases are named,
  // and a tool call never adds its name or command: the transcript shows that.
  let phase = "Working";
  if (state.phase === "thinking") {
    phase = "Thinking";
  } else if (state.phase === "responding") {
    phase = "Responding";
  }

  const rightPlain = `${formatDuration(Math.max(0, now - state.startedAt))} · ${interruptKey} to stop`;
  const right = theme.fg("dim", rightPlain);
  if (width <= visibleWidth(right)) return truncateToWidth(right, width, "…");

  const left = theme.fg("text", phase);
  const available = width - visibleWidth(right) - COLUMN_GAP.length;
  if (available <= 0) return right;
  return `${truncateToWidth(left, available, "…")}${COLUMN_GAP}${right}`;
}

/** The terminal title after a run, or `undefined` when the run was short or aborted. */
export function doneTitle(elapsedMs: number, aborted: boolean): string | undefined {
  if (aborted || elapsedMs < DONE_TITLE_MS) return undefined;
  return `✓ pi · done ${formatDuration(elapsedMs)}`;
}
