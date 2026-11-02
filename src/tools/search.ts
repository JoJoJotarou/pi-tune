import type { AgentToolResult, FindToolDetails, GrepToolDetails, LsToolDetails } from "@earendil-works/pi-coding-agent";

/** Right side of the grep header: match and file counts, and whether the match limit was reached. */
export function grepMeta(_result: AgentToolResult<GrepToolDetails | undefined>): string {
  throw new Error("not implemented");
}

/** Right side of the find header: the file count, and whether the result limit was reached. */
export function findMeta(_result: AgentToolResult<FindToolDetails | undefined>): string {
  throw new Error("not implemented");
}

/** Right side of the ls header: the directory and file counts, and whether the entry limit was reached. */
export function lsMeta(_result: AgentToolResult<LsToolDetails | undefined>): string {
  throw new Error("not implemented");
}
