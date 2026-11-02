import type { Theme } from "@earendil-works/pi-coding-agent";

export type ToolStatus = "running" | "success" | "error";

/** running until the call has a final result; then error when context.isError, else success. */
export function toolStatus(context: { executionStarted: boolean; isPartial: boolean; isError: boolean }): ToolStatus {
  throw new Error("not implemented");
}

export interface HeaderParts {
  status: ToolStatus;
  name: string;
  summary: string;
  meta?: string;
  durationMs?: number;
}

/** Exactly one line, never wider than `width`. */
export function renderHeader(parts: HeaderParts, width: number, theme: Theme): string {
  throw new Error("not implemented");
}
