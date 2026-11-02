import type { AgentToolResult, ReadToolDetails, ReadToolInput } from "@earendil-works/pi-coding-agent";

/** Right side of the read header: the line count, the offset/limit range, or the truncation. */
export function readMeta(_args: ReadToolInput, _result: AgentToolResult<ReadToolDetails | undefined>): string {
  throw new Error("not implemented");
}
