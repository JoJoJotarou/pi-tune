import { formatReadLineRange, keyText, type Theme, type ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { exitCodeOf, failureExcerpt, summarizeCommand } from "./bash.ts";
import { renderHeader, toolStatus } from "./header.ts";

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

function failureExitCode(context: CompactContext): number | undefined {
  const value = context.state.exitCode;
  return typeof value === "number" ? value : undefined;
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
    case "read": {
      const path = stringArg(args, "path") ?? "";
      const range =
        args.offset === undefined && args.limit === undefined ? "" : formatReadLineRange(args.offset, args.limit);
      return `${path}${range}`;
    }
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
    const exitCode = status === "error" && this.toolName === "bash" ? failureExitCode(this.context) : undefined;
    const header = renderHeader(
      {
        status,
        name: this.toolName,
        summary: this.summary,
        meta: exitCode === undefined ? undefined : `exit ${exitCode}`,
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
      if (toolName === "bash") context.state.exitCode = exitCodeOf(output);
      if (options.expanded) {
        return baseRenderResult ? baseRenderResult(result, options, theme, context) : new EmptyComponent();
      }
      return new ResultComponent(output, theme, context);
    },
  };
};
