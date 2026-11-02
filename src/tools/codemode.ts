import type { Theme } from "@earendil-works/pi-coding-agent";
import { highlightCode } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { formatDuration } from "../shared/format.ts";

export type CodemodeStatus = "running" | "ok" | "error" | "cancelled";

/** One inner tool call of a script, as `details.calls` reports it. */
export interface CodemodeCall {
  name: string;
  args: string;
  status: CodemodeStatus;
  durationMs?: number;
}

const TOOL_CALL = /tools\.([A-Za-z_$][\w$]*)\s*\(/g;
const STATUSES: CodemodeStatus[] = ["running", "ok", "error", "cancelled"];

/** Distinct tool names the script calls, in first-use order (`tools.read(` counts as `read`). */
export function scriptToolNames(code: string): string[] {
  const names: string[] = [];
  for (const match of code.matchAll(TOOL_CALL)) {
    const name = match[1];
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

function argText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function callStatus(value: unknown): CodemodeStatus {
  // `unfinished` is Pi's name for a call that was still running when the tool finished.
  if (value === "unfinished") return "running";
  return STATUSES.find((status) => status === value) ?? "running";
}

/** The inner calls of a codemode result, tolerant of a missing or partial record. */
export function codemodeCalls(details: unknown): CodemodeCall[] {
  if (typeof details !== "object" || details === null) return [];
  const calls = (details as { calls?: unknown }).calls;
  if (!Array.isArray(calls)) return [];

  return calls
    .filter((call): call is Record<string, unknown> => typeof call === "object" && call !== null)
    .map((call) => ({
      name: typeof call.name === "string" ? call.name : "?",
      args: argText(call.args ?? call.arguments),
      status: callStatus(call.status),
      durationMs: typeof call.durationMs === "number" ? call.durationMs : undefined,
    }));
}

/** Header summary: the tools the script calls, or the calls made when the code names none. */
export function codemodeSummary(code: string, calls: CodemodeCall[]): string {
  const fromCode = scriptToolNames(code);
  if (fromCode.length > 0) return fromCode.join(", ");
  return [...new Set(calls.map((call) => call.name))].join(", ");
}

/** Right side of the header: `2 calls`, plus ` · 1 failed` when a call failed. */
export function codemodeMeta(calls: CodemodeCall[]): string | undefined {
  if (calls.length === 0) return undefined;
  const failed = calls.filter((call) => call.status === "error").length;
  const count = `${calls.length} call${calls.length === 1 ? "" : "s"}`;
  return failed > 0 ? `${count} · ${failed} failed` : count;
}

const PREAMBLE = /^Script (?:completed|failed)$/;
const WALL_TIME = /^Wall time [\d.]+ seconds?$/;
const OUTPUT_HEADER = /^Output:$/;

/** The script's output without the `Script completed / Wall time / Output:` preamble. */
export function scriptOutput(resultText: string): string[] {
  const lines = resultText.split("\n");
  let start = 0;
  if (lines.length > 0 && PREAMBLE.test(lines[0])) {
    start = 1;
    while (start < lines.length && (lines[start] === "" || WALL_TIME.test(lines[start]))) start++;
    if (start < lines.length && OUTPUT_HEADER.test(lines[start])) start++;
  }

  const output = lines.slice(start);
  while (output.length > 0 && output[0].trim() === "") output.shift();
  while (output.length > 0 && output[output.length - 1].trim() === "") output.pop();
  return output;
}

/** The last `limit` output lines, and how many lines before them are hidden. */
export function errorTail(output: string[], limit: number): { lines: string[]; hidden: number } {
  if (output.length <= limit) return { lines: output, hidden: 0 };
  return { lines: output.slice(-limit), hidden: output.length - limit };
}

/** The whole script, highlighted, wrapped so no line is wider than `width`. */
export function scriptLines(code: string, width: number, theme: Theme): string[] {
  const source = code.replace(/\n$/, "");
  const plain = source.split("\n");
  const highlighted = highlightCode(source, "javascript");
  const lines = highlighted.length === plain.length ? highlighted : plain;

  const rows: string[] = [];
  for (const line of lines) {
    const wrapped = wrapTextWithAnsi(line, Math.max(1, width));
    rows.push(...(wrapped.length === 0 ? [""] : wrapped));
  }
  return rows;
}

const CALL_ICONS: Record<CodemodeStatus, { icon: string; color: "warning" | "success" | "error" | "dim" }> = {
  running: { icon: "●", color: "warning" },
  ok: { icon: "✓", color: "success" },
  error: { icon: "✗", color: "error" },
  cancelled: { icon: "⊘", color: "dim" },
};

function callDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : formatDuration(ms);
}

/** One row per inner call: `✓ read {"path":"README.md"} 5ms`. */
export function callLines(calls: CodemodeCall[], width: number, theme: Theme): string[] {
  return calls.map((call) => {
    const { icon, color } = CALL_ICONS[call.status];
    const parts = [theme.fg(color, icon), theme.bold(call.name), theme.fg("muted", call.args)];
    if (call.durationMs !== undefined) parts.push(theme.fg("dim", callDuration(call.durationMs)));
    return truncateToWidth(parts.join(" "), width, "…");
  });
}

/** The expanded body: script, inner calls, then the output, each section after one blank line. */
export function codemodeBody(
  code: string,
  calls: CodemodeCall[],
  output: string[],
  width: number,
  theme: Theme,
): string[] {
  const sections = [
    scriptLines(code, width, theme),
    callLines(calls, width, theme),
    output.map((line) => truncateToWidth(line, width, "…")),
  ].filter((section) => section.length > 0);

  return sections.flatMap((section, index) => (index === 0 ? section : ["", ...section]));
}
