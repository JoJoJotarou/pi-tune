import {
  type AgentToolResult,
  type EditToolDetails,
  type FindToolDetails,
  type GrepToolDetails,
  type LsToolDetails,
  type ReadToolDetails,
  type ReadToolInput,
  renderDiff,
  type Theme,
  type ToolRendererResolver,
} from "@earendil-works/pi-coding-agent";
import { Box, type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { exitCodeOf, failureTail, summarizeCommand } from "./bash.ts";
import {
  bashCommandLines,
  diffMeta,
  firstChange,
  PREVIEW_LINES,
  previewLines,
  trimOutput,
  truncationLine,
} from "./body.ts";
import { renderHeader, statusBackground, toolStatus } from "./header.ts";
import { readMeta } from "./read.ts";
import { findMeta, grepMeta, lsMeta } from "./search.ts";
import { planWrite, renderWriteLines, writeRecord } from "./write.ts";

const COMPACT_TOOLS = new Set(["bash", "read", "edit", "write", "grep", "find", "ls"]);

/** Body lines start under the tool name: the header is indented by `outputPad`, the body by two more. */
const BODY_INDENT = 2;
/** Output lines shown for a failed call while it is collapsed. */
const FAILURE_LINES = 3;

interface CompactContext {
  state: Record<string, unknown>;
  executionStarted: boolean;
  isPartial: boolean;
  isError: boolean;
  durationMs: number | undefined;
  outputPad: number;
}

/** Body lines at a given content width; the shell paints and indents them. */
type LineSource = (width: number) => string[];

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

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

/** The one header line, painted by the box around it. */
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
    const meta = this.context.state.meta;
    return [
      renderHeader(
        {
          status: toolStatus(this.context),
          name: this.toolName,
          summary: this.summary,
          meta: typeof meta === "string" ? meta : undefined,
          durationMs: this.context.durationMs,
        },
        width,
        this.theme,
      ),
    ];
  }

  invalidate(): void {}
}

/** Body lines indented under the tool name and cut to the width the box gives them. */
class BodyComponent implements Component {
  private readonly source: LineSource;

  constructor(source: LineSource) {
    this.source = source;
  }

  render(width: number): string[] {
    const indent = " ".repeat(BODY_INDENT);
    return this.source(Math.max(1, width - BODY_INDENT)).map((line) => truncateToWidth(`${indent}${line}`, width, "…"));
  }

  invalidate(): void {}
}

/** The header box: one line, no painted rows around it. The background follows the live status. */
class HeaderBoxComponent implements Component {
  private readonly header: HeaderComponent;
  private readonly theme: Theme;
  private readonly context: CompactContext;

  constructor(header: HeaderComponent, theme: Theme, context: CompactContext) {
    this.header = header;
    this.theme = theme;
    this.context = context;
  }

  render(width: number): string[] {
    const box = new Box(this.context.outputPad, 0, statusBackground(toolStatus(this.context), this.theme));
    box.addChild(this.header);
    return box.render(width);
  }

  invalidate(): void {}
}

/** The body box: one painted blank row above and below the indented body lines. */
class BodyBoxComponent implements Component {
  private readonly lines: LineSource;
  private readonly theme: Theme;
  private readonly context: CompactContext;

  constructor(lines: LineSource, theme: Theme, context: CompactContext) {
    this.lines = lines;
    this.theme = theme;
    this.context = context;
  }

  render(width: number): string[] {
    const box = new Box(this.context.outputPad, 1, statusBackground(toolStatus(this.context), this.theme));
    box.addChild(new BodyComponent(this.lines));
    return box.render(width);
  }

  invalidate(): void {}
}

class EmptyComponent implements Component {
  render(): string[] {
    return [];
  }

  invalidate(): void {}
}

/**
 * Pi hands `lastComponent` back to the renderer that produced it, and its own renderers reuse such a
 * component (`clear()`) when they redraw. Never pass our block to them: they would mutate it.
 */
function nativeContext<T extends { lastComponent?: Component }>(context: T): T {
  return { ...context, lastComponent: undefined };
}

/** Lines of a component at a content width, with no trailing blanks. */
function componentSource(component: Component | undefined): LineSource {
  return (width) => (component === undefined ? [] : trimOutput(component.render(width)));
}

/** The tail of a failed result plus the truncation line. */
function errorSource(output: string, theme: Theme): LineSource {
  return () => {
    const { lines, hidden } = failureTail(output, FAILURE_LINES);
    return hidden > 0 ? [...lines, truncationLine(hidden, theme)] : lines;
  };
}

/** Pi's rendered diff; collapsed, the preview starts at the first change so it shows what changed. */
function diffSource(diffText: string, expanded: boolean, theme: Theme): LineSource {
  const lines = renderDiff(diffText).split("\n");
  if (expanded || lines.length <= PREVIEW_LINES) return () => lines;
  const start = Math.min(firstChange(diffText), lines.length - PREVIEW_LINES);
  return () => [...lines.slice(start, start + PREVIEW_LINES), truncationLine(lines.length - PREVIEW_LINES, theme)];
}

function bashSource(command: string, expanded: boolean, native: LineSource, theme: Theme): LineSource {
  if (!expanded) return native;
  return (width) => [...bashCommandLines(command, width, theme), "", ...native(width)];
}

export const toolRenderers: ToolRendererResolver = (toolName, next) => {
  const base = next();
  if (!COMPACT_TOOLS.has(toolName) || !base) return base;

  const baseRenderResult = base.renderResult;

  return {
    ...base,
    renderShell: "self",
    renderCall: (args, theme, context) =>
      new HeaderBoxComponent(new HeaderComponent(toolName, summaryFor(toolName, args), theme, context), theme, context),
    renderResult: (result, options, theme, context) => {
      const output = resultText(result);
      context.state.meta = resultMeta(toolName, context.args, result, context.isError, output);
      const expanded = options.expanded;

      if (toolName === "edit") {
        if (context.isError) return new BodyBoxComponent(errorSource(output, theme), theme, context);
        const details = result.details as EditToolDetails | undefined;
        if (typeof details?.diff !== "string") {
          context.state.meta = undefined;
          const fallback = baseRenderResult?.(result, options, theme, nativeContext(context));
          return fallback === undefined
            ? new EmptyComponent()
            : new BodyBoxComponent(componentSource(fallback), theme, context);
        }
        const diff = details.diff;
        context.state.meta = diffMeta(diff);
        const lines = diffSource(diff, expanded, theme);
        return new BodyBoxComponent(
          (width) => (toolStatus(context) === "error" ? errorSource(output, theme)(width) : lines(width)),
          theme,
          context,
        );
      }

      if (toolName === "write") {
        if (context.isError) return new BodyBoxComponent(errorSource(output, theme), theme, context);
        if (!context.executionStarted || options.isPartial) return new EmptyComponent();

        const path = stringArg(textArgs(context.args), "path") ?? "";
        const content = stringArg(textArgs(context.args), "content") ?? "";
        const plan = planWrite(writeRecord(context.toolCallId), content);
        context.state.meta = plan.meta;
        if (plan.body === "none") return new EmptyComponent();

        const lines: LineSource =
          plan.body === "diff" && plan.diff !== undefined
            ? diffSource(plan.diff, expanded, theme)
            : (width) => renderWriteLines(path, content, expanded, width, theme);
        return new BodyBoxComponent(
          (width) => (toolStatus(context) === "error" ? errorSource(output, theme)(width) : lines(width)),
          theme,
          context,
        );
      }

      const native = componentSource(
        baseRenderResult?.(result, { expanded: true, isPartial: false }, theme, nativeContext(context)),
      );
      const command = stringArg(textArgs(context.args), "command") ?? "";
      const body = toolName === "bash" ? bashSource(command, expanded, native, theme) : native;
      return new BodyBoxComponent(
        (width) => {
          if (toolStatus(context) === "error" && !expanded) return errorSource(output, theme)(width);
          if (!expanded) return [];
          return body(width);
        },
        theme,
        context,
      );
    },
  };
};
