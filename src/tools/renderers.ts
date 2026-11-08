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
  ToolRenderers,
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
import { renderHeader, statusBackground, type ToolStatus, toolStatus } from "./header.ts";
import { railCoveredColumns } from "./rail.ts";
import { readMeta, skillLabel } from "./read.ts";
import {
  callExpanded,
  MERGEABLE_TOOLS,
  memberBody,
  memberLabel,
  memberRow,
  type RunView,
  recordFacts,
  registerBody,
  registerLabel,
  registerRow,
  runCountLabel,
  runHead,
  runView,
  setHeadExpanded,
  toggleCallExpanded,
} from "./run.ts";
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
  invalidate: () => void;
  executionStarted: boolean;
  expanded: boolean;
  isPartial: boolean;
  isError: boolean;
  durationMs: number | undefined;
  outputPad: number;
}

/** How often a running row's clock advances, the same cadence as the status line. */
const CLOCK_MS = 250;

/** The row's clock, kept in Pi's renderer state: Pi only fills `durationMs` once the call ends. */
interface RowClock {
  startedAt?: number;
  timer?: ReturnType<typeof setInterval>;
}

/** Start the clock once the tool executes; redraws the row every {@link CLOCK_MS} while it runs. */
function startClock(context: CompactContext): void {
  const clock = context.state as RowClock;
  if (clock.startedAt !== undefined) return;
  clock.startedAt = Date.now();
  clock.timer = setInterval(() => context.invalidate(), CLOCK_MS);
  // A running tool must not keep the process alive on its own; Bun's timers may lack `unref`.
  clock.timer.unref?.();
}

function stopClock(context: CompactContext): void {
  const clock = context.state as RowClock;
  if (clock.timer === undefined) return;
  clearInterval(clock.timer);
  clock.timer = undefined;
}

/** Milliseconds since the tool started, or `undefined` before it started or for a row that never started. */
function elapsedMs(context: CompactContext): number | undefined {
  const startedAt = (context.state as RowClock).startedAt;
  return typeof startedAt === "number" ? Math.max(0, Date.now() - startedAt) : undefined;
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

/** One call's header line at exactly `width`; the box paints it, and the run card draws its members through it. */
function headerLines(context: CompactContext, text: HeaderText, theme: Theme, width: number): string[] {
  const meta = context.state.meta;
  const summary = context.state.summary;
  const status = toolStatus(context);
  const liveMs = status === "running" ? elapsedMs(context) : undefined;
  // Expanded bash ends with the timer line Pi's own body draws, so its final duration is on that line only.
  // While running there is no such line yet, and the header carries the live clock.
  const timerInBody = context.expanded && text.name === "bash" && status !== "running";
  return renderHeader(
    {
      status,
      name: text.name,
      summary: typeof summary === "string" ? summary : text.summary,
      meta: typeof meta === "string" ? meta : undefined,
      durationMs: timerInBody ? undefined : (liveMs ?? context.durationMs),
      nameColor: text.nameColor,
      summaryColor: text.summaryColor,
      expanded: context.expanded,
    },
    Math.max(1, width),
    theme,
  );
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
    const covered = railCoveredColumns();
    const lines = headerLines(this.context, this.text, this.theme, Math.max(1, width - covered));
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

/**
 * Pi redraws the whole transcript on every frame (each wheel step, each streamed token) and expects every block to
 * hand back cached lines. The boxes keep their last lines while the width and every input they draw from are
 * unchanged. Pi updates a tool's context in place, so each of those inputs is part of the key.
 */
class RenderCache {
  private key: string | undefined;
  private lines: string[] = [];

  get(inputs: unknown[], draw: () => string[]): string[] {
    const key = JSON.stringify(inputs);
    if (key !== this.key) {
      this.lines = draw();
      this.key = key;
    }
    return this.lines;
  }

  clear(): void {
    this.key = undefined;
  }
}

/** The header box: the header line between one painted blank row above and below. The background follows the live status. */
class HeaderBoxComponent implements Component {
  private readonly header: HeaderComponent;
  private readonly theme: Theme;
  private readonly context: CompactContext;
  private readonly cache = new RenderCache();

  constructor(header: HeaderComponent, theme: Theme, context: CompactContext) {
    this.header = header;
    this.theme = theme;
    this.context = context;
  }

  render(width: number): string[] {
    const { outputPad, expanded, durationMs, state } = this.context;
    const status = toolStatus(this.context);
    const liveMs = status === "running" ? elapsedMs(this.context) : undefined;
    const inputs = [
      width,
      railCoveredColumns(),
      outputPad,
      status,
      expanded,
      liveMs ?? durationMs,
      state.meta,
      state.summary,
    ];
    return this.cache.get(inputs, () => {
      const box = new Box(outputPad, 1, statusBackground(status, this.theme));
      box.addChild(this.header);
      return box.render(width);
    });
  }

  invalidate(): void {
    this.cache.clear();
  }
}

/** The body box: the indented body lines under one painted blank row, which closes the tool block. */
class BodyBoxComponent implements Component {
  private readonly lines: LineSource;
  private readonly theme: Theme;
  private readonly context: CompactContext;
  private readonly cache = new RenderCache();

  constructor(lines: LineSource, theme: Theme, context: CompactContext) {
    this.lines = lines;
    this.theme = theme;
    this.context = context;
  }

  /** Line sources read the context only through `toolStatus`; the rest is fixed when `renderResult` builds them. */
  render(width: number): string[] {
    const { outputPad } = this.context;
    const status = toolStatus(this.context);
    return this.cache.get([width, railCoveredColumns(), outputPad, status], () => {
      const box = new Box(outputPad, 0, statusBackground(status, this.theme));
      box.addChild(new BodyComponent(this.lines));
      return box.render(width);
    });
  }

  /** The body lines at exactly `width`, unpainted; the open run card draws opened bodies through this. */
  content(width: number): string[] {
    return trimOutput(this.lines(Math.max(1, width - 2 * BODY_INDENT)));
  }

  invalidate(): void {
    this.cache.clear();
  }
}

class EmptyComponent implements Component {
  render(): string[] {
    return [];
  }

  invalidate(): void {}
}

/** A rendered row's click target: a member call, the group header (`null`), or a non-clickable row. */
type CardHit = string | null | undefined;

/**
 * The one card a run draws. Folded, it is the aggregate header row. Open, the same card draws every
 * member's own header line and any opened body, so the group stays one painted block instead of Pi's
 * per-tool spacing splitting it into separate blocks. The head call owns the card; members draw nothing.
 */
class RunHeaderComponent implements Component {
  private readonly normal: Component;
  private readonly toolCallId: string;
  private readonly theme: Theme;
  private readonly context: CompactContext;
  private readonly cache = new RenderCache();
  private hits: CardHit[] = [];

  constructor(normal: Component, toolCallId: string, theme: Theme, context: CompactContext) {
    this.normal = normal;
    this.toolCallId = toolCallId;
    this.theme = theme;
    this.context = context;
  }

  render(width: number): string[] {
    const headId = runHead(this.toolCallId, this.context.expanded);
    if (headId === undefined) {
      this.hits = [];
      return this.normal.render(width);
    }
    if (headId !== this.toolCallId) {
      this.hits = [];
      return [];
    }
    const view = runView(headId);
    if (view === undefined) {
      this.hits = [];
      return this.normal.render(width);
    }
    return this.card(width, view);
  }

  private card(width: number, view: RunView): string[] {
    const { members, statuses, open, durationMs } = view;
    const covered = railCoveredColumns();
    // Every row stays until the fold: a call still queued shows as pending, a finished one keeps its
    // own result. A group the user folded stays folded. A running member's clock advances the card.
    const shownIds = open ? members.map((member) => member.id) : [];
    const opened = shownIds.filter((id) => callExpanded(id));
    const key = [
      width,
      covered,
      this.context.outputPad,
      open,
      shownIds,
      opened,
      statuses,
      durationMs,
      statuses.includes("running") ? Math.floor(Date.now() / CLOCK_MS) : undefined,
    ];
    return this.cache.get(key, () => {
      const padX = this.context.outputPad;
      const lineWidth = Math.max(1, width - 2 * padX - covered);
      const lead = " ".repeat(padX);
      const tail = " ".repeat(padX + covered);
      const paints: Record<ToolStatus, (text: string) => string> = {
        running: statusBackground("running", this.theme),
        success: statusBackground("success", this.theme),
        error: statusBackground("error", this.theme),
      };
      const lines: string[] = [];
      const hits: CardHit[] = [];
      // Each row carries its own status color, so one failed call reddens its row, not the whole card.
      const push = (status: ToolStatus, content: string, hit: CardHit): void => {
        lines.push(paints[status](`${lead}${truncateToWidth(content, lineWidth, "…", true)}${tail}`));
        hits.push(hit);
      };

      const failed = members.filter((_, index) => statuses[index] === "error");
      // A group is red only when every call failed; a mixed run stays open-looking with a red failure.
      const overall: ToolStatus =
        statuses.length > 0 && statuses.every((status) => status === "error")
          ? "error"
          : statuses.some((status) => status === "queued" || status === "running")
            ? "running"
            : "success";
      const failure =
        failed.length === 0
          ? ""
          : failed.length === 1
            ? `1 failed: ${memberLabel(failed[0].id) ?? failed[0].name}`
            : `${failed.length} failed`;
      const counts = runCountLabel(members.map((member) => member.name));
      const name = failure === "" ? counts : `${counts} · ${this.theme.fg("error", failure)}`;

      // The painted rows above and below belong to the header: clicking either folds the run.
      push(overall, "", null);
      const header = renderHeader(
        {
          status: overall,
          name,
          summary: "",
          durationMs,
          // The run always shows its fold control; the status color and the rows carry the rest.
          icon: open ? "▾" : "▸",
        },
        lineWidth,
        this.theme,
      );
      for (const line of header) push(overall, line, null);

      if (open) {
        const rowWidth = Math.max(1, lineWidth - BODY_INDENT);
        const bodyWidth = Math.max(1, lineWidth - 2 * BODY_INDENT);
        const rowIndent = " ".repeat(BODY_INDENT);
        const bodyIndent = " ".repeat(2 * BODY_INDENT);
        for (const [index, member] of members.entries()) {
          const status = statuses[index];
          const rowStatus: ToolStatus = status === "queued" ? "running" : status;
          for (const line of memberRow(member.id, rowWidth)) push(rowStatus, `${rowIndent}${line}`, member.id);
          // A failed call always shows its error tail; successful calls open theirs on click.
          if (!callExpanded(member.id) && status !== "error") continue;
          for (const line of memberBody(member.id, bodyWidth)) push(rowStatus, `${bodyIndent}${line}`, member.id);
        }
      }
      push(overall, "", null);

      this.hits = hits;
      return lines;
    });
  }

  handleMouse(event: { type: string; button: string; y: number }): { handled: boolean; render: boolean } | undefined {
    if (event.type !== "click" || event.button !== "left") return undefined;
    const hit = this.hits[event.y];
    const headId = runHead(this.toolCallId, this.context.expanded);
    if (hit === undefined || headId === undefined) return undefined;
    if (hit === null) {
      setHeadExpanded(headId, !(runView(headId)?.open ?? false));
    } else {
      toggleCallExpanded(hit);
    }
    return { handled: true, render: true };
  }

  invalidate(): void {
    this.normal.invalidate();
    this.cache.clear();
  }
}

/** The result of a grouped call: its body is drawn inside the group card instead of its own block. */
class RunResultComponent implements Component {
  private readonly normal: Component;
  private readonly toolCallId: string;
  private readonly context: CompactContext;

  constructor(normal: Component, toolCallId: string, context: CompactContext) {
    this.normal = normal;
    this.toolCallId = toolCallId;
    this.context = context;
  }

  render(width: number): string[] {
    return runHead(this.toolCallId, this.context.expanded) === undefined ? this.normal.render(width) : [];
  }

  invalidate(): void {
    this.normal.invalidate();
  }
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

  const renderers: ToolRenderers = {
    ...base,
    renderShell: "self",
    renderCall: (args, theme, context) => {
      if (context.executionStarted && context.isPartial) startClock(context);
      else stopClock(context);
      const text = headerText(toolName, args, context);
      return new HeaderBoxComponent(new HeaderComponent(text, theme, context), theme, context);
    },
    renderResult: (result, options, theme, context) => {
      if (!options.isPartial) stopClock(context);
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

  // Consecutive read-only calls collapse into one card (see run.ts): the head draws the aggregate
  // header, and once opened it draws every member's own row and opened body inside the same painted
  // card; members draw nothing themselves. Facts and row/body renderers are registered here so the
  // head can draw them; the wrappers decide per frame, so a plan change or a click needs no swap.
  if (!MERGEABLE_TOOLS.has(toolName)) return renderers;

  return {
    ...renderers,
    renderCall: (args, theme, context) => {
      // A queued call has no facts yet; `runView` reports it as queued until it starts.
      if (context.executionStarted) recordFacts(context.toolCallId, { status: toolStatus(context) });
      const text = headerText(toolName, args, context);
      registerLabel(context.toolCallId, text.summary === "" ? text.name : text.summary);
      registerRow(context.toolCallId, (width) => headerLines(context, text, theme, width));
      const normal = renderers.renderCall?.(args, theme, context) ?? new EmptyComponent();
      return new RunHeaderComponent(normal, context.toolCallId, theme, context);
    },
    renderResult: (result, options, theme, context) => {
      recordFacts(context.toolCallId, { status: toolStatus(context), durationMs: context.durationMs });
      const normal = renderers.renderResult?.(result, options, theme, context) ?? new EmptyComponent();
      // The card opens a body on click, outside Pi's own expansion flag. Build that body only when
      // the card first draws it, and cache it for the width until this result updates again.
      let expanded: Component | undefined;
      let cachedWidth = -1;
      let cachedLines: string[] = [];
      registerBody(context.toolCallId, (width) => {
        expanded ??=
          options.expanded || context.isError
            ? normal
            : (renderers.renderResult?.(result, { ...options, expanded: true }, theme, context) ??
              new EmptyComponent());
        if (width !== cachedWidth) {
          cachedWidth = width;
          cachedLines = expanded instanceof BodyBoxComponent ? expanded.content(width) : [];
        }
        return cachedLines;
      });
      return new RunResultComponent(normal, context.toolCallId, context);
    },
  };
};
