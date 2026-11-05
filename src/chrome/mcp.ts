import { readJsonObject } from "../shared/config.ts";

/** Server names that differ only in `-` and `_` are one server; tool names use `_` for both. */
export function canonicalServerName(name: string): string {
  return name.replace(/-/g, "_");
}

export interface McpServerEntry {
  command?: unknown;
  url?: unknown;
  type?: unknown;
  enabled?: unknown;
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerEntry>;
}

/** A parsed `mcp.json` document: an object whose `mcpServers`, when present, is an object. */
export function isMcpConfig(value: unknown): value is McpConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const servers = (value as { mcpServers?: unknown }).mcpServers;
  return servers === undefined || (typeof servers === "object" && servers !== null && !Array.isArray(servers));
}

function serverEntries(config: unknown): [string, McpServerEntry][] {
  if (!isMcpConfig(config) || config.mcpServers === undefined) return [];
  const entries: [string, McpServerEntry][] = [];
  for (const [name, entry] of Object.entries(config.mcpServers)) {
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      entries.push([name, entry as McpServerEntry]);
    }
  }
  return entries;
}

function hasTransport(entry: McpServerEntry): boolean {
  return entry.command !== undefined || entry.url !== undefined || entry.type !== undefined;
}

/**
 * User entries overlaid with the trusted project's entries, keyed by canonical name.
 * A project entry with a transport replaces the user entry; one without only overrides `enabled`.
 */
export function mergeServers(user: unknown, project?: unknown): Map<string, McpServerEntry> {
  const merged = new Map<string, McpServerEntry>();
  for (const [name, entry] of serverEntries(user)) merged.set(canonicalServerName(name), entry);
  for (const [name, entry] of serverEntries(project)) {
    const key = canonicalServerName(name);
    const base = merged.get(key);
    const replacement =
      base !== undefined && !hasTransport(entry) ? { ...base, enabled: entry.enabled ?? base.enabled } : entry;
    merged.set(key, replacement);
  }
  return merged;
}

/** Enabled server names: the merged config plus registered names the config does not define. */
export function configuredServers(
  files: { user?: unknown; project?: unknown },
  registered: readonly string[] = [],
): string[] {
  const merged = mergeServers(files.user, files.project);
  const names = new Set<string>();
  for (const [name, entry] of merged) {
    if (entry.enabled !== false) names.add(name);
  }
  for (const name of registered) {
    const key = canonicalServerName(name);
    if (!merged.has(key)) names.add(key);
  }
  return [...names];
}

/** The server in a `mcp__<server>__<tool>` tool name, or `undefined` for any other tool. */
export function serverNameFromTool(toolName: string): string | undefined {
  const prefix = "mcp__";
  if (!toolName.startsWith(prefix)) return undefined;
  const end = toolName.indexOf("__", prefix.length);
  if (end <= prefix.length) return undefined;
  return canonicalServerName(toolName.slice(prefix.length, end));
}

/** Distinct server names among the tool names, canonicalized so `-` and `_` collide. */
export function connectedServers(toolNames: readonly string[]): string[] {
  const names = new Set<string>();
  for (const toolName of toolNames) {
    const server = serverNameFromTool(toolName);
    if (server !== undefined) names.add(server);
  }
  return [...names];
}

/** Parsed `mcp.json`; `undefined` when the file is missing, with one warning when it exists but is unusable. */
export function readMcpFile(path: string, notify: (message: string, level: "warning") => void): McpConfig | undefined {
  const read = readJsonObject(path);
  if (!read.ok) {
    notify(`pi-tune MCP config skipped: ${path} ${read.problem}`, "warning");
    return undefined;
  }
  if (read.value !== undefined && !isMcpConfig(read.value)) {
    notify(`pi-tune MCP config skipped: ${path} has an "mcpServers" value that is not an object`, "warning");
    return undefined;
  }
  return read.value;
}
