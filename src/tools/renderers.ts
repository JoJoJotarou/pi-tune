import type {
  AgentToolResult,
  EditToolDetails,
  FindToolDetails,
  GrepToolDetails,
  LsToolDetails,
  ReadToolDetails,
  ReadToolInput,
  Theme,
  ToolRendererResolver,
} from "@earendil-works/pi-coding-agent";
import { Box, type Component, truncateToWidth } from "@earendil-works/pi-tui";
import { exitCodeOf, failureTail, summarizeCommand } from "./bash.ts";
import { diffMeta, PREVIEW_LINES, trimOutput, truncationLine } from "./body.ts";
import {
  codemodeBody,
  codemodeCalls,
  codemodeMeta,
  codemodeSummary,
  errorTail,
  scriptOutput,
  scriptToolNames,
} from "./codemode.ts";
import { previewLines, renderDiffRows } from "./diff.ts";
import { renderHeader, statusBackground, toolStatus } from "./header.ts";
import { readMeta } from "./read.ts";
import { findMeta, grepMeta, lsMeta } from "./search.ts";
import { grepBody, listBody } from "./tree.ts";
import { planWrite, renderWriteLines, writeRecord } from "./write.ts";

const COMPACT_TOOLS = new Set(["bash", "read", "edit", "write", "grep", "find", "ls", "codemode"]);

/** Body lines start under the tool name: the header is indented by `outputPad`, the body by two more. */
const BODY_INDENT = 2;
/** Output lines shown for a failed call while it is collapsed. */
const FAILURE_LINES = 3;

interface CompactContext {
  state: Record<string, unknown>;
  executionStarted: boolean;
  expanded: boolean;
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
    case "codemode": {
      const code = stringArg(args, "code");
      return code === undefined ? "" : scriptToolNames(code).join(", ");
    }
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

/** The header text: bash shows its whole command once expanded, every other tool keeps its summary. */
function headerSummary(toolName: string, rawArgs: unknown, expanded: boolean): string {
  if (toolName === "bash" && expanded) {
    const command = stringArg(textArgs(rawArgs), "command");
    if (command !== undefined) return command.replace(/\n$/, "");
  }
  return summaryFor(toolName, rawArgs);
}

/** The header, painted by the box around it: one line while collapsed, the summary wrapped once expanded. */
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
    const summary = this.context.state.summary;
    // Expanded bash ends with the timer line Pi's own body draws, so its duration is on that line only.
    const timerInBody = this.context.expanded && this.toolName === "bash";
    return renderHeader(
      {
        status: toolStatus(this.context),
        name: this.toolName,
        summary: typeof summary === "string" ? summary : this.summary,
        meta: typeof meta === "string" ? meta : undefined,
        durationMs: timerInBody ? undefined : this.context.durationMs,
        expanded: this.context.expanded,
      },
      width,
      this.theme,
    );
  }

  invalidate(): void {}
}

/**
 * Body lines indented under the tool name and cut to the width the box gives them, plus the painted blank row
 * that closes the block. The header already brings the blank row above the body.
 */
class BodyComponent implements Component {
  private readonly source: LineSource;

  constructor(source: LineSource) {
    this.source = source;
  }

  render(width: number): string[] {
    const indent = " ".repeat(BODY_INDENT);
    const lines = this.source(Math.max(1, width - BODY_INDENT));
    if (lines.length === 0) return [];
    return [...lines.map((line) => truncateToWidth(`${indent}${line}`, width, "…")), indent];
  }

  invalidate(): void {}
}

/** The header box: the header line between one painted blank row above and below. The background follows the live status. */
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
    const box = new Box(this.context.outputPad, 1, statusBackground(toolStatus(this.context), this.theme));
    box.addChild(this.header);
    return box.render(width);
  }

  invalidate(): void {}
}

/** The body box: the indented body lines under one painted blank row, which closes the tool block. */
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
    const box = new Box(this.context.outputPad, 0, statusBackground(toolStatus(this.context), this.theme));
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

/** The diff with tinted rows; collapsed, the preview starts at the first change so it shows what changed. */
function diffSource(diffText: string, expanded: boolean, theme: Theme): LineSource {
  const options = { wrap: expanded };
  const lines = diffText.split("\n");
  if (expanded || lines.length <= PREVIEW_LINES) return (width) => renderDiffRows(diffText, width, theme, options);
  const preview = previewLines(diffText, PREVIEW_LINES).join("\n");
  return (width) => [
    ...renderDiffRows(preview, width, theme, options),
    truncationLine(lines.length - PREVIEW_LINES, theme),
  ];
}

export const toolRenderers: ToolRendererResolver = (toolName, next) => {
  const base = next();
  if (!COMPACT_TOOLS.has(toolName) || !base) return base;

  const baseRenderResult = base.renderResult;

  return {
    ...base,
    renderShell: "self",
    renderCall: (args, theme, context) =>
      new HeaderBoxComponent(
        new HeaderComponent(toolName, headerSummary(toolName, args, context.expanded), theme, context),
        theme,
        context,
      ),
    renderResult: (result, options, theme, context) => {
      const output = resultText(result);
      const expanded = options.expanded;

      if (toolName === "codemode") {
        const code = stringArg(textArgs(context.args), "code") ?? "";
        const calls = codemodeCalls(result.details);
        const lines = scriptOutput(output);
        context.state.summary = codemodeSummary(code, calls);
        context.state.meta = codemodeMeta(calls);
        return new BodyBoxComponent(
          (width) => {
            if (expanded) return codemodeBody(code, calls, lines, width, theme);
            if (toolStatus(context) !== "error") return [];
            const tail = errorTail(lines, FAILURE_LINES);
            return tail.hidden > 0 ? [...tail.lines, truncationLine(tail.hidden, theme)] : tail.lines;
          },
          theme,
          context,
        );
      }

      context.state.meta = resultMeta(toolName, context.args, result, context.isError, output);

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
      const search = toolName === "grep" || toolName === "find" || toolName === "ls";
      const body =
        search && toolStatus(context) !== "error"
          ? (width: number) => (toolName === "grep" ? grepBody(output, width, theme) : listBody(output, width, theme))
          : native;
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
