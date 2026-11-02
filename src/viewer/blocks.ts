import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export interface ViewerBlock {
  kind: "tool" | "code";
  title: string;
  body: string;
  lang?: string;
}

interface ToolCallInfo {
  args: Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toolSummary(toolName: string, args: Record<string, unknown> | undefined): string | undefined {
  switch (toolName) {
    case "bash":
      return text(args?.command)?.split("\n")[0].trim();
    case "read":
    case "edit":
    case "write":
      return text(args?.path);
    case "grep": {
      const pattern = text(args?.pattern);
      return pattern === undefined ? undefined : `"${pattern}"`;
    }
    case "find":
      return text(args?.pattern);
    case "ls":
      return text(args?.path) ?? ".";
    default:
      return undefined;
  }
}

function codeBlock(lang: string, body: string[]): ViewerBlock {
  const title = lang.toLowerCase() === "mermaid" ? "mermaid" : lang === "" ? "code" : `${lang} code`;
  return { kind: "code", title, body: body.join("\n"), lang: lang === "" ? undefined : lang };
}

function codeBlocks(textContent: string): ViewerBlock[] {
  const blocks: ViewerBlock[] = [];
  let open: { lang: string; body: string[] } | undefined;
  for (const line of textContent.split("\n")) {
    if (open) {
      if (line.trimStart().startsWith("```")) {
        blocks.push(codeBlock(open.lang, open.body));
        open = undefined;
      } else {
        open.body.push(line);
      }
      continue;
    }
    const fence = /^\s*```(\S*)\s*$/.exec(line);
    if (fence) open = { lang: fence[1] ?? "", body: [] };
  }
  if (open) blocks.push(codeBlock(open.lang, open.body));
  return blocks;
}

export function collectBlocks(entries: readonly SessionEntry[]): ViewerBlock[] {
  const blocks: ViewerBlock[] = [];
  const calls = new Map<string, ToolCallInfo>();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type === "toolCall") {
          calls.set(part.id, { args: part.arguments as Record<string, unknown> });
        } else if (part.type === "text") {
          blocks.push(...codeBlocks(part.text));
        }
      }
      continue;
    }
    if (message.role !== "toolResult") continue;
    const summary = toolSummary(message.toolName, calls.get(message.toolCallId)?.args);
    blocks.push({
      kind: "tool",
      title: summary === undefined || summary === "" ? message.toolName : `${message.toolName} · ${summary}`,
      body: message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .replace(/\n$/, ""),
    });
  }
  return blocks;
}
