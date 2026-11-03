import type {
  AgentToolResult,
  EditToolDetails,
  FindToolDetails,
  GrepToolDetails,
  LsToolDetails,
  ReadToolDetails,
  ReadToolInput,
  Theme,
  ThemeColor,
  ToolRendererResolver,
} from "@earendil-works/pi-coding-agent";
import { getLanguageFromPath } from "@earendil-works/pi-coding-agent";
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
import { prepareDiff, previewLines, renderDiffRows } from "./diff.ts";
import { renderHeader, statusBackground, toolStatus } from "./header.ts";
import { railCoveredColumns } from "./rail.ts";
import { readMeta, skillLabel } from "./read.ts";
import { findMeta, grepMeta, lsMeta } from "./search.ts";
import { grepBody, listBody } from "./tree.ts";
import { planWrite, renderWriteLines, writeRecord } from "./write.ts";

const COMPACT_TOOLS = new Set(["bash", "read", "edit", "write", "grep", "find", "ls", "codemode"]);

/**
 * The body starts under the tool name and keeps the same width free on the right: the header is indented by
 * `outputPad`, the body by two more on both sides.
 */
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

interface HeaderText {
  name: string;
  summary: string;
  /** Set by labels Pi's own renderers style, such as the `[skill]` one. */
  nameColor?: ThemeColor;
  summaryColor?: ThemeColor;
}

/**
 * The bold label and the summary beside it. A `SKILL.md` read takes Pi's own label (`[skill] <name>`)
 * instead of the path, which says nothing about what the file is. Bash shows its whole command once
 * expanded.
 */
function headerText(toolName: string, rawArgs: unknown, context: { cwd: string; expanded: boolean }): HeaderText {
  const args = textArgs(rawArgs);
  if (toolName === "read") {
    const path = stringArg(args, "path");
    const skill = path === undefined ? undefined : skillLabel(path, context.cwd);
    if (skill !== undefined) {
      return {
        name: "[skill]",
        summary: skill,
        nameColor: "customMessageLabel",
        summaryColor: "customMessageText",
      };
    }
  }
  if (toolName === "bash" && context.expanded) {
    const command = stringArg(args, "command");
    if (command !== undefined) return { name: "bash", summary: command.replace(/\n$/, "") };
  }
  return { name: toolName, summary: summaryFor(toolName, rawArgs) };
}

/** The header, painted by the box around it: one line while collapsed, the summary wrapped once expanded. */
class HeaderComponent implements Component {
  private readonly text: HeaderText;
  private readonly theme: Theme;
  private readonly context: CompactContext;

  constructor(text: HeaderText, theme: Theme, context: CompactContext) {
    this.text = text;
    this.theme = theme;
    this.context = context;
  }

  render(width: number): string[] {
    const meta = this.context.state.meta;
    const summary = this.context.state.summary;
    // Expanded bash ends with the timer line Pi's own body draws, so its duration is on that line only.
    const timerInBody = this.context.expanded && this.text.name === "bash";
    // The timeline rail sits on top of the transcript's right columns: keep them blank so the counts stay whole.
    const covered = railCoveredColumns();
    const lines = renderHeader(
      {
        status: toolStatus(this.context),
        name: this.text.name,
        summary: typeof summary === "string" ? summary : this.text.summary,
        meta: typeof meta === "string" ? meta : undefined,
        durationMs: timerInBody ? undefined : this.context.durationMs,
        nameColor: this.text.nameColor,
        summaryColor: this.text.summaryColor,
        expanded: this.context.expanded,
      },
      Math.max(1, width - covered),
      this.theme,
    );
    return covered === 0 ? lines : lines.map((line) => `${line}${" ".repeat(covered)}`);
  }

  invalidate(): void {}
}

/**
 * Body lines indented under the tool name, the same two columns kept free on the right plus whatever the timeline
 * rail covers, and the painted blank row that closes the block. The header already brings the blank row above it.
 */
class BodyComponent implements Component {
  private readonly source: LineSource;

  constructor(source: LineSource) {
    this.source = source;
  }

  render(width: number): string[] {
    const indent = " ".repeat(BODY_INDENT);
    const covered = railCoveredColumns();
    const contentWidth = Math.max(1, width - 2 * BODY_INDENT - covered);
    const lines = this.source(contentWidth);
    if (lines.length === 0) return [];
    const right = " ".repeat(BODY_INDENT + covered);
    return [
      ...lines.map((line) => `${truncateToWidth(`${indent}${line}`, contentWidth + BODY_INDENT, "…")}${right}`),
      indent,
    ];
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

/**
 * The diff with tinted rows and highlighted code; collapsed, the preview starts at the first change so it shows what
 * changed. The code is highlighted once here, not on every redraw.
 */
function diffSource(diffText: string, path: string, expanded: boolean, theme: Theme): LineSource {
  const options = { wrap: expanded };
  const lines = diffText.split("\n");
  const folded = !expanded && lines.length > PREVIEW_LINES;
  const shown = folded ? previewLines(diffText, PREVIEW_LINES).join("\n") : diffText;
  const prepared = prepareDiff(shown, getLanguageFromPath(path));
  return (width) => {
    const rows = renderDiffRows(prepared, width, theme, options);
    return folded ? [...rows, truncationLine(lines.length - PREVIEW_LINES, theme)] : rows;
  };
}

export const toolRenderers: ToolRendererResolver = (toolName, next) => {
  const base = next();
  if (!COMPACT_TOOLS.has(toolName) || !base) return base;

  const baseRenderResult = base.renderResult;

  return {
    ...base,
    renderShell: "self",
    renderCall: (args, theme, context) => {
      const text = headerText(toolName, args, context);
      return new HeaderBoxComponent(new HeaderComponent(text, theme, context), theme, context);
    },
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
        const lines = diffSource(diff, stringArg(textArgs(context.args), "path") ?? "", expanded, theme);
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
            ? diffSource(plan.diff, path, expanded, theme)
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
