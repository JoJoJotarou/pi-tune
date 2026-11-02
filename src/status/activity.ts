import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatDuration } from "../shared/format.ts";

const SUMMARY_WIDTH = 40;
const COLUMN_GAP = "   ";

export type ActivityPhase = "thinking" | "writing" | "tool";

export interface RunningTool {
  id: string;
  name: string;
  summary: string;
}

export interface ActivityState {
  running: boolean;
  /** When `agent_start` fired; the only timer on the status line. */
  startedAt: number;
  phase: ActivityPhase;
  /** Running tools in start order; the last one is the most recent. */
  tools: RunningTool[];
  /** Output tokens of the current message. */
  outputTokens: number;
  /** First text token of the current message, `0` before it arrives. */
  writingStartedAt: number;
}

export const initialState: ActivityState = {
  running: false,
  startedAt: 0,
  phase: "thinking",
  tools: [],
  outputTokens: 0,
  writingStartedAt: 0,
};

export type ActivityEvent =
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "message_update"; kind: "thinking" | "text"; outputTokens: number }
  | { type: "tool_execution_start"; id: string; name: string; args: unknown }
  | { type: "tool_execution_end"; id: string }
  | { type: "agent_settled" };

function firstLine(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = value.split("\n")[0]?.trim() ?? "";
  return line === "" ? undefined : line;
}

function arg(args: unknown, key: string): unknown {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>)[key] : undefined;
}

function cut(text: string | undefined): string {
  if (text === undefined) return "";
  return truncateToWidth(text, SUMMARY_WIDTH, "…");
}

/** Short description of a tool call for the working message: `sleep 6`, `/repo/a.ts`, `"TODO"`. */
export function summarizeTool(name: string, args: unknown): string {
  switch (name) {
    case "bash":
      return cut(firstLine(arg(args, "command")));
    case "read":
    case "edit":
    case "write":
      return cut(firstLine(arg(args, "path")));
    case "grep": {
      const pattern = firstLine(arg(args, "pattern"));
      return pattern === undefined ? "" : cut(`"${pattern}"`);
    }
    case "find":
      return cut(firstLine(arg(args, "pattern")));
    case "ls":
      return cut(firstLine(arg(args, "path")) ?? ".");
    default:
      return "";
  }
}

export function reduce(state: ActivityState, event: ActivityEvent, now: number): ActivityState {
  switch (event.type) {
    case "agent_start":
      return {
        running: true,
        startedAt: now,
        phase: "thinking",
        tools: [],
        outputTokens: 0,
        writingStartedAt: 0,
      };
    case "turn_start":
      return { ...state, phase: "thinking", tools: [], outputTokens: 0, writingStartedAt: 0 };
    case "message_update": {
      if (event.kind === "thinking") {
        return { ...state, phase: "thinking", outputTokens: event.outputTokens };
      }
      return {
        ...state,
        phase: "writing",
        outputTokens: event.outputTokens,
        writingStartedAt: state.writingStartedAt === 0 ? now : state.writingStartedAt,
      };
    }
    case "tool_execution_start": {
      const tools = [
        ...state.tools.filter((tool) => tool.id !== event.id),
        { id: event.id, name: event.name, summary: summarizeTool(event.name, event.args) },
      ];
      return { ...state, phase: "tool", tools };
    }
    case "tool_execution_end": {
      const tools = state.tools.filter((tool) => tool.id !== event.id);
      return { ...state, phase: tools.length === 0 ? "thinking" : "tool", tools };
    }
    case "agent_settled":
      return { ...state, running: false, tools: [] };
  }
}

/** Output tokens per second of the current message, once it has written for at least a second. */
function tokenRate(state: ActivityState, now: number): number | undefined {
  if (state.writingStartedAt === 0) return undefined;
  const elapsedMs = now - state.writingStartedAt;
  if (elapsedMs < 1000 || state.outputTokens <= 0) return undefined;
  return Math.round(state.outputTokens / (elapsedMs / 1000));
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
 * Same colors in every phase: phase `text`, detail `muted`, total and hint `dim`.
 */
export function describe(state: ActivityState, now: number, options: DescribeOptions): string {
  if (!state.running) return "";
  const { width, interruptKey, theme } = options;
  if (width <= 0) return "";

  let phase = "Thinking";
  let detail = "";
  if (state.phase === "writing") {
    const rate = tokenRate(state, now);
    phase = "Writing";
    if (rate !== undefined) detail = `${rate} tok/s`;
  } else if (state.phase === "tool" && state.tools.length > 0) {
    const latest = state.tools[state.tools.length - 1];
    const others = state.tools.length - 1;
    phase = latest.name;
    detail = [latest.summary, others > 0 ? `+${others}` : ""].filter((part) => part !== "").join(" ");
  }

  const rightPlain = `${formatDuration(Math.max(0, now - state.startedAt))} · ${interruptKey} to stop`;
  const right = theme.fg("dim", rightPlain);
  if (width <= visibleWidth(right)) return truncateToWidth(right, width, "…");

  const left = theme.fg("text", phase) + (detail === "" ? "" : ` ${theme.fg("muted", detail)}`);
  const available = width - visibleWidth(right) - COLUMN_GAP.length;
  if (available <= 0) return right;
  return `${truncateToWidth(left, available, "…")}${COLUMN_GAP}${right}`;
}
