import {
  type AgentToolResult,
  type FindToolDetails,
  type GrepToolDetails,
  keyText,
  type LsToolDetails,
  type ReadToolDetails,
  type ReadToolInput,
  type Theme,
  type ToolRendererResolver,
} from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { exitCodeOf, failureExcerpt, summarizeCommand } from "./bash.ts";
import { renderHeader, toolStatus } from "./header.ts";
import { readMeta } from "./read.ts";
import { findMeta, grepMeta, lsMeta, renderGrepRows } from "./search.ts";

const COMPACT_TOOLS = new Set(["bash", "read", "edit", "write", "grep", "find", "ls"]);

interface CompactContext {
  state: Record<string, unknown>;
  executionStarted: boolean;
  isPartial: boolean;
  isError: boolean;
  durationMs: number | undefined;
  outputPad: number;
}

function textArgs(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

/** The right side of the header: only known once the result is in. */
function resultMeta(
  toolName: string,
  args: unknown,
  result: AgentToolResult<unknown>,
  isError: boolean,
  output: string,
): string | undefined {
  if (toolName === "bash") {
    if (!isError) return undefined;
    const code = exitCodeOf(output);
    return code === undefined ? undefined : `exit ${code}`;
  }

  if (isError) return undefined;
  switch (toolName) {
    case "read":
      return readMeta(args as ReadToolInput, result as AgentToolResult<ReadToolDetails | undefined>);
    case "grep":
      return grepMeta(result as AgentToolResult<GrepToolDetails | undefined>);
    case "find":
      return findMeta(result as AgentToolResult<FindToolDetails | undefined>);
    case "ls":
      return lsMeta(result as AgentToolResult<LsToolDetails | undefined>);
    default:
      return undefined;
  }
}

function summaryFor(toolName: string, rawArgs: unknown): string {
  const args = textArgs(rawArgs);

  switch (toolName) {
    case "bash": {
      const command = stringArg(args, "command");
      if (command === undefined) return "";
      const { first, extraLines } = summarizeCommand(command);
      return extraLines > 0 ? `${first} +${extraLines} lines` : first;
    }
    case "read":
      return stringArg(args, "path") ?? "";
    case "edit":
    case "write":
      return stringArg(args, "path") ?? "";
    case "grep": {
      const pattern = stringArg(args, "pattern");
      if (pattern === undefined) return "";
      return `"${pattern}" in ${stringArg(args, "path") ?? "."}`;
    }
    case "find": {
      const pattern = stringArg(args, "pattern");
      if (pattern === undefined) return "";
      return `${pattern} in ${stringArg(args, "path") ?? "."}`;
    }
    case "ls":
      return stringArg(args, "path") ?? ".";
    default:
      return "";
  }
}

class HeaderComponent implements Component {
  private readonly toolName: string;
  private readonly summary: string;
  private readonly theme: Theme;
  private readonly context: CompactContext;

  constructor(toolName: string, summary: string, theme: Theme, context: CompactContext) {
    this.toolName = toolName;
    this.summary = summary;
    this.theme = theme;
    this.context = context;
  }

  render(width: number): string[] {
    const status = toolStatus(this.context);
    const meta = this.context.state.meta;
    const header = renderHeader(
      {
        status,
        name: this.toolName,
        summary: this.summary,
        meta: typeof meta === "string" ? meta : undefined,
        durationMs: this.context.durationMs,
      },
      Math.max(0, width - this.context.outputPad),
      this.theme,
    );
    return [truncateToWidth(`${" ".repeat(this.context.outputPad)}${header}`, width, "…")];
  }

  invalidate(): void {}
}

class ResultComponent implements Component {
  private readonly resultText: string;
  private readonly theme: Theme;
  private readonly context: CompactContext;

  constructor(resultText: string, theme: Theme, context: CompactContext) {
    this.resultText = resultText;
    this.theme = theme;
    this.context = context;
  }

  render(width: number): string[] {
    if (toolStatus(this.context) !== "error") return [];

    const indent = " ".repeat(this.context.outputPad + 2);
    const prefix = `${indent}${this.theme.fg("dim", "│ ")}`;
    const available = Math.max(0, width - this.context.outputPad - 4);

    return failureExcerpt(this.resultText, keyText("app.tools.expand")).map((line) => {
      const content = this.theme.fg("toolOutput", truncateToWidth(line, available, "…"));
      return truncateToWidth(`${prefix}${content}`, width, "…");
    });
  }

  invalidate(): void {}
}

class GrepRowsComponent implements Component {
  private readonly result: AgentToolResult<GrepToolDetails | undefined>;
  private readonly theme: Theme;
  private readonly context: CompactContext;

  constructor(result: AgentToolResult<GrepToolDetails | undefined>, theme: Theme, context: CompactContext) {
    this.result = result;
    this.theme = theme;
    this.context = context;
  }

  render(width: number): string[] {
    return renderGrepRows(this.result, width, this.theme, this.context.outputPad);
  }

  invalidate(): void {}
}

class EmptyComponent implements Component {
  render(): string[] {
    return [];
  }

  invalidate(): void {}
}

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

export const toolRenderers: ToolRendererResolver = (toolName, next) => {
  const base = next();
  if (!COMPACT_TOOLS.has(toolName) || !base) return base;

  const baseRenderResult = base.renderResult;
  return {
    ...base,
    renderShell: "self",
    renderCall: (args, theme, context) => new HeaderComponent(toolName, summaryFor(toolName, args), theme, context),
    renderResult: (result, options, theme, context) => {
      const output = resultText(result);
      context.state.meta = resultMeta(toolName, context.args, result, context.isError, output);
      if (options.expanded && toolName === "grep") return new GrepRowsComponent(result, theme, context);
      if (options.expanded) {
        return baseRenderResult ? baseRenderResult(result, options, theme, context) : new EmptyComponent();
      }
      return new ResultComponent(output, theme, context);
    },
  };
};
