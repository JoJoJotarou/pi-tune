import {
  type AgentToolResult,
  type EditToolDetails,
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
import type { StructuredPatchHunk } from "diff";
import { exitCodeOf, failureExcerpt, summarizeCommand } from "./bash.ts";
import { type DiffStats, diffStats, hunksFromPatch, renderDiff } from "./diff.ts";
import { renderHeader, toolStatus } from "./header.ts";
import { readMeta } from "./read.ts";
import { findMeta, grepMeta, lsMeta, renderGrepRows } from "./search.ts";
import { FOLD_LIMIT, planWrite, renderWriteLines, writeRecord } from "./write.ts";

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

interface EditDiff {
  path: string;
  hunks: StructuredPatchHunk[];
}

function editDiffOf(result: AgentToolResult<unknown>, rawArgs: unknown): EditDiff | undefined {
  const details = result.details as EditToolDetails | undefined;
  if (details === undefined || typeof details.patch !== "string") return undefined;
  const path = stringArg(textArgs(rawArgs), "path");
  if (path === undefined) return undefined;
  return { path, hunks: hunksFromPatch(details.patch) };
}

function editMeta(stats: DiffStats, folded: boolean): string {
  const counts = `+${stats.added} −${stats.removed}`;
  return folded ? `${counts} · ${keyText("app.tools.expand")}` : counts;
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

class DiffComponent implements Component {
  private readonly diff: EditDiff;
  private readonly contextLines: number;
  private readonly theme: Theme;
  private readonly context: CompactContext;

  constructor(diff: EditDiff, contextLines: number, theme: Theme, context: CompactContext) {
    this.diff = diff;
    this.contextLines = contextLines;
    this.theme = theme;
    this.context = context;
  }

  render(width: number): string[] {
    const indentWidth = this.context.outputPad + 2;
    const indent = " ".repeat(indentWidth);
    const available = Math.max(1, width - indentWidth);
    return renderDiff(this.diff.hunks, {
      path: this.diff.path,
      width: available,
      theme: this.theme,
      context: this.contextLines,
    }).map((line) => truncateToWidth(`${indent}${line}`, width, "…"));
  }

  invalidate(): void {}
}

class WriteLinesComponent implements Component {
  private readonly path: string;
  private readonly content: string;
  private readonly expanded: boolean;
  private readonly theme: Theme;
  private readonly context: CompactContext;

  constructor(path: string, content: string, expanded: boolean, theme: Theme, context: CompactContext) {
    this.path = path;
    this.content = content;
    this.expanded = expanded;
    this.theme = theme;
    this.context = context;
  }

  render(width: number): string[] {
    const indentWidth = this.context.outputPad + 2;
    const indent = " ".repeat(indentWidth);
    const available = Math.max(1, width - indentWidth);
    return renderWriteLines(this.path, this.content, this.expanded, available, this.theme).map((line) =>
      truncateToWidth(`${indent}${line}`, width, "…"),
    );
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
      if (toolName === "edit") {
        if (context.isError) return new ResultComponent(output, theme, context);
        const diff = editDiffOf(result, context.args);
        if (diff === undefined) {
          context.state.meta = undefined;
          return baseRenderResult ? baseRenderResult(result, options, theme, context) : new EmptyComponent();
        }
        const stats = diffStats(diff.hunks);
        const folded = !options.expanded && stats.added + stats.removed > FOLD_LIMIT;
        context.state.meta = editMeta(stats, folded);
        if (folded) return new EmptyComponent();
        return new DiffComponent(diff, options.expanded ? 3 : 1, theme, context);
      }
      if (toolName === "write") {
        if (context.isError) return new ResultComponent(output, theme, context);
        if (!context.executionStarted || options.isPartial) return new EmptyComponent();

        const path = stringArg(textArgs(context.args), "path") ?? "";
        const content = stringArg(textArgs(context.args), "content") ?? "";
        const plan = planWrite(writeRecord(context.toolCallId), content, options.expanded);
        context.state.meta = plan.meta;
        if (plan.body === "diff" && plan.hunks !== undefined) {
          return new DiffComponent({ path, hunks: plan.hunks }, options.expanded ? 3 : 1, theme, context);
        }
        if (plan.body === "new") return new WriteLinesComponent(path, content, options.expanded, theme, context);
        return new EmptyComponent();
      }
      if (options.expanded && toolName === "grep" && !context.isError) {
        return new GrepRowsComponent(result, theme, context);
      }
      if (options.expanded) {
        return baseRenderResult ? baseRenderResult(result, options, theme, context) : new EmptyComponent();
      }
      return new ResultComponent(output, theme, context);
    },
  };
};
