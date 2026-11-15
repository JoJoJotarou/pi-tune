import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
  getMarkdownTheme,
  initTheme,
  type KeybindingsManager,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { type Component, type EditorTheme, ScrollView, type TUI, VStack, visibleWidth } from "@earendil-works/pi-tui";
import { Drawer, type DrawerView } from "../src/btw/drawer.ts";
import { renderBtw } from "../src/btw/render.ts";
import type { BtwThread } from "../src/btw/thread.ts";
import { ThreadList, threadItems } from "../src/btw/thread-list.ts";
import { type FooterParts, footerLine } from "../src/chrome/footer.ts";
import { headerLine } from "../src/chrome/header.ts";
import { blockEdgeRow, blockRows, statusLine } from "../src/editor/block.ts";
import { PastePreview } from "../src/editor/paste-preview.ts";
import { SuggestPanel } from "../src/editor/suggest-panel.ts";
import { TuneEditor, type TuneEditorOptions } from "../src/editor/tune-editor.ts";
import {
  hoverCardState,
  RAIL_WIDTH,
  railRows,
  TimelineHoverCard,
  TimelineRail,
  timelineGeometry,
} from "../src/navigation/timeline.ts";
import { workedEntry } from "../src/status/worked.ts";
import { buildThinkingWindow } from "../src/thinking/window.ts";
import { callLines, codemodeBody, scriptLines } from "../src/tools/codemode.ts";
import { prepareDiff, renderDiffRows } from "../src/tools/diff.ts";
import { renderHeader } from "../src/tools/header.ts";
import { toolRenderers } from "../src/tools/renderers.ts";
import { grepBody, listBody, treeRows } from "../src/tools/tree.ts";
import { rememberWriteRecord, renderWriteLines } from "../src/tools/write.ts";
import { testTheme } from "./theme.ts";
import { assertFits } from "./width.ts";

initTheme("dark", false);

const theme = testTheme("dark");
const markdown = getMarkdownTheme();

const WIDTHS = [1, 2, 3, 8, 20, 40, 80, 120];
/** Pi's `Box` pads one column on each side, so a component wrapped in one needs two columns. */
const BOX_WIDTHS = WIDTHS.filter((width) => width >= 2);

/** One hostile value each: plain text, no break opportunity, double width, joined and flag emoji, escapes, a tab. */
const CORPUS: { name: string; text: string }[] = [
  { name: "ascii", text: "plain ascii text that has to wrap somewhere" },
  { name: "long token", text: "x".repeat(300) },
  { name: "cjk", text: "这是一段很长的中文文本，里面没有空格，只有标点。" },
  { name: "emoji", text: "👨‍👩‍👧‍👦 family 🏳️‍🌈 pride 🇨🇳 flag ✨" },
  { name: "ansi", text: "\u001b[31mred\u001b[0m \u001b[1;32mbold green\u001b[0m" },
  { name: "tab", text: "a\tb\tc\td" },
];

interface Row {
  name: string;
  /** Widths to check when the entry point does not take one, or is meant for a fixed range of them. */
  widths?: readonly number[];
  render: (text: string, width: number) => string[];
}

/** An assistant message whose answer is `text`, enough for the drawer. */
function answer(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "probe",
    model: "probe-model",
    api: "openai-completions",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 1,
  } as AssistantMessage;
}

function btwThread(text: string): BtwThread {
  return {
    id: "btw-1",
    anchorEntryId: "e1",
    anchorTurns: 1,
    turns: [{ text, question: text, messages: [answer(text)], askedAt: 1, durationMs: 1200, denied: [text] }],
  };
}

function footerParts(text: string): FooterParts {
  return {
    project: text,
    cwd: text,
    session: text,
    branch: text,
    git: { ahead: 12, behind: 3, added: 120_000, deleted: 90_000 },
    hints: text,
    stats: {
      input: 35_000,
      output: 18_000,
      cacheRead: 1_600_000,
      cacheWrite: 12_000,
      cost: 1234.567,
      cacheHitPercent: 91,
      contextTokens: 53_000,
      contextPercent: 5.3,
      contextWindow: 1_000_000,
      rate: 48,
      ttftMs: 1800,
      autoCompact: true,
    },
    identity: { provider: text, model: text, thinking: text, level: "high" },
    statuses: [
      ["z", text],
      ["a", text],
    ],
  };
}

const RAIL_GEOMETRY = timelineGeometry({
  prompts: [
    { row: 0, text: "first prompt" },
    { row: 30, text: "second prompt" },
    { row: 60, text: "third prompt" },
  ],
  viewportTop: 30,
  height: 20,
  atBottom: false,
});

/** Pi's transcript tree around a chat, as the rail walks it. */
function railTui(prompt: string): TUI {
  const chat = { children: [new UserMessageComponent(prompt)] as Component[], render: () => [] };
  const document = {
    children: [{ render: () => [] }, { render: () => [] }, chat],
    render: () => [],
    addChild: () => {},
  };
  const view = new ScrollView(document as never, { primary: true });
  view.updateLayout(30, 30, () => {});
  const tui = {
    children: [document],
    layoutRoot: new VStack([view]),
    terminal: { columns: 80, rows: 30 },
    viewportTop: 30,
    scrollTop: 30,
    selecting: false,
    hasActiveSelection: () => tui.selecting,
    scrollBy(lines: number) {
      tui.scrollTop += lines;
    },
    requestRender() {},
  };
  return tui as unknown as TUI;
}

function makeEditor(): TuneEditor {
  const tui = { requestRender() {}, terminal: { rows: 30, cols: 100 } } as unknown as TUI;
  const editorTheme = { borderColor: (text: string) => text, selectList: {} } as EditorTheme;
  const keybindings = { matches: () => false } as unknown as KeybindingsManager;
  const options: Partial<TuneEditorOptions> = { theme: () => theme };
  return new TuneEditor(tui, editorTheme, keybindings, options as TuneEditorOptions);
}

const baseRenderers = {
  renderShell: "default",
  renderCall: () => ({ render: () => [], invalidate() {} }),
  renderResult: () => ({ render: () => [], invalidate() {} }),
} as const;

interface ToolCase {
  args: (text: string) => unknown;
  result: (text: string) => AgentToolResult<unknown>;
}

const TOOL_CASES: Record<string, ToolCase> = {
  bash: {
    args: (text) => ({ command: `printf '%s' "${text}"` }),
    result: (text) => ({ content: [{ type: "text", text: `${text}\nexit 1` }], details: undefined }),
  },
  read: {
    args: (text) => ({ path: text }),
    result: (text) => ({ content: [{ type: "text", text: `${text}\n${text}` }], details: undefined }),
  },
  edit: {
    args: (text) => ({ path: text }),
    result: (text) => ({ content: [], details: { diff: ` 1 same\n-2 ${text}\n+2 ${text}` } }),
  },
  write: {
    args: (text) => ({ path: "src/a.ts", content: text }),
    result: () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
  },
  grep: {
    args: (text) => ({ pattern: text, path: "src" }),
    result: (text) => ({ content: [{ type: "text", text: `src/a.ts:1: ${text}` }], details: undefined }),
  },
  find: {
    args: (text) => ({ pattern: text, path: "src" }),
    result: (text) => ({ content: [{ type: "text", text: `src/a.ts\n${text}` }], details: undefined }),
  },
  ls: {
    args: (text) => ({ path: text }),
    result: (text) => ({ content: [{ type: "text", text: `src/\n${text}` }], details: undefined }),
  },
};

function renderTool(name: string, text: string, width: number, kind: "call" | "result"): string[] {
  const spec = TOOL_CASES[name];
  assert.ok(spec, name);
  const renderers = toolRenderers(name, () => baseRenderers);
  assert.ok(renderers, `${name} was not resolved`);
  const toolCallId = `call-${name}-${width}`;
  const args = spec.args(text);
  const ctx = {
    args,
    toolCallId,
    invalidate() {},
    lastComponent: undefined,
    state: {} as Record<string, unknown>,
    cwd: "/tmp",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: true,
    showImages: true,
    isError: false,
    durationMs: 1200,
    outputPad: 1,
  };
  if (name === "write") rememberWriteRecord(toolCallId, { existed: true, oldText: "old line\n" });
  if (kind === "call") {
    assert.ok(renderers.renderCall, `${name} has no renderCall`);
    return renderers.renderCall(args, theme, ctx).render(width);
  }
  assert.ok(renderers.renderResult, `${name} has no renderResult`);
  return renderers.renderResult(spec.result(text), { expanded: true, isPartial: false }, theme, ctx).render(width);
}

const rows: Row[] = [
  {
    name: "tools/header renderHeader",
    render: (text, width) =>
      renderHeader({ status: "success", name: text, summary: text, meta: text, durationMs: 1200 }, width, theme),
  },
  // The line-number gutter alone is four columns (src/tools/diff.ts:220), so these rows are wider than the width
  // below five or six columns; the subtests below fail there until the gutter is clipped.
  {
    name: "tools/diff renderDiffRows (wrapped)",
    render: (text, width) =>
      renderDiffRows(prepareDiff(` 1 same\n-2 ${text}\n+2 ${text}`, undefined), width, theme, { wrap: true }),
  },
  {
    name: "tools/diff renderDiffRows (cut)",
    render: (text, width) =>
      renderDiffRows(prepareDiff(` 1 same\n-2 ${text}\n+2 ${text}`, undefined), width, theme, { wrap: false }),
  },
  {
    name: "tools/tree treeRows",
    render: (text, width) => treeRows([{ text, children: [{ text }, { text }] }], width, theme),
  },
  { name: "tools/tree listBody", render: (text, width) => listBody(`${text}/\n${text}`, width, theme) },
  {
    name: "tools/tree grepBody",
    render: (text, width) => grepBody(`src/a.ts:1: ${text}\nsrc/a.ts-2- ${text}`, width, theme),
  },
  {
    name: "tools/write renderWriteLines",
    render: (text, width) => renderWriteLines("a.ts", `${text}\n${text}\n${text}\n${text}`, false, width, theme),
  },
  // A double-width glyph cannot be split over one column, and Pi's wrapper keeps it whole.
  { name: "tools/codemode scriptLines", widths: BOX_WIDTHS, render: (text, width) => scriptLines(text, width) },
  {
    name: "tools/codemode callLines",
    render: (text, width) => callLines([{ name: "read", args: text, status: "ok", durationMs: 12 }], width, theme),
  },
  {
    name: "tools/codemode codemodeBody",
    widths: BOX_WIDTHS,
    render: (text, width) =>
      codemodeBody(text, [{ name: "read", args: text, status: "running" }], [text], width, theme),
  },
  ...Object.keys(TOOL_CASES).flatMap((name): Row[] => [
    // The call is a `Box`, and Pi's box has the two-column minimum above.
    {
      name: `tools/renderers ${name} renderCall`,
      widths: BOX_WIDTHS,
      render: (text, width) => renderTool(name, text, width, "call"),
    },
    // An expanded body indents two columns and pads two on the right inside Pi's box (src/tools/renderers.ts:298),
    // so it needs six; the subtests below fail below that until the indent is clipped.
    {
      name: `tools/renderers ${name} renderResult`,
      render: (text, width) => renderTool(name, text, width, "result"),
    },
  ]),
  { name: "chrome/footer footerLine", render: (text, width) => footerLine(footerParts(text), width, theme) },
  {
    name: "chrome/header headerLine",
    render: (text, width) => [
      headerLine({ version: "1.4.0", cwd: text, skills: 12, mcp: { connected: 2, configured: 3 } }, width, theme),
    ],
  },
  {
    name: "status/worked workedEntry",
    render: (_text, width) => {
      const entry = workedEntry({ ms: 1250 }, theme);
      assert.ok(entry);
      return entry.render(width);
    },
  },
  // buildThinkingWindow widens anything under 8 columns: src/thinking/window.ts:318.
  {
    name: "thinking/window buildThinkingWindow",
    widths: WIDTHS.filter((width) => width >= 8),
    render: (text, width) => [buildThinkingWindow(text, width, visibleWidth, true)],
  },
  // The rail draws a fixed RAIL_WIDTH column and TimelineRail truncates each row to the width it is given.
  {
    name: "navigation/timeline railRows",
    widths: [RAIL_WIDTH],
    render: () => railRows(RAIL_GEOMETRY as never, { kind: "tick", index: 1 }, theme),
  },
  {
    name: "navigation/timeline TimelineRail",
    render: (text, width) =>
      new TimelineRail(
        railTui(text) as never,
        () => theme,
        () => {},
        () => {},
      ).render(width),
  },
  {
    name: "navigation/timeline TimelineHoverCard",
    render: (text, width) => {
      const card = new TimelineHoverCard(() => theme);
      const state = hoverCardState(text, 5, 80, 30);
      if (state) card.show(state);
      return card.render(width);
    },
  },
  {
    name: "btw/render renderBtw",
    render: (text, width) =>
      renderBtw({
        thread: btwThread(text),
        number: 1,
        mainTurns: 3,
        pending: { question: text, answer: text, phase: text, elapsedMs: 1200, spinner: "⠋" },
        maxHeight: 16,
        width,
        theme,
        markdown,
      }).lines,
  },
  {
    name: "btw/drawer Drawer",
    render: (text, width) =>
      new Drawer({
        view: () =>
          ({
            open: true,
            thread: btwThread(text),
            number: 1,
            mainTurns: 3,
            pending: { question: text, answer: text, phase: text, startedAt: 0 },
            revision: 0,
          }) satisfies DrawerView,
        theme,
        terminalRows: () => 30,
        now: () => 0,
      }).render(width),
  },
  {
    name: "btw/thread-list ThreadList",
    widths: BOX_WIDTHS,
    render: (text, width) =>
      new ThreadList({
        items: threadItems([btwThread(text)], 4),
        tui: { requestRender() {} },
        theme,
        done() {},
      }).render(width),
  },
  // blockRows is only called with a width whose content column is positive: src/editor/tune-editor.ts:220.
  {
    name: "editor/block blockRows",
    widths: WIDTHS.filter((width) => width >= 4),
    render: (text, width) => blockRows([text, text], width, "❯", (line) => line),
  },
  {
    name: "editor/block blockEdgeRow",
    render: (_text, width) => [blockEdgeRow(width, "top", theme.colors.toolPendingBg, theme)],
  },
  { name: "editor/block statusLine", render: (text, width) => [statusLine(text, width)] },
  {
    name: "editor/paste-preview PastePreview",
    render: (text, width) => new PastePreview(theme, 1, `${text}\n${text}`, 20, () => {}).render(width),
  },
  // Below four columns the block has no gutter and TuneEditor falls back to Pi's own editor.
  {
    name: "editor/tune-editor TuneEditor",
    widths: WIDTHS.filter((width) => width >= 4),
    render: (text, width) => {
      const editor = makeEditor();
      editor.setText(text);
      return editor.render(width);
    },
  },
  {
    name: "editor/suggest-panel SuggestPanel",
    render: (_text, width) =>
      new SuggestPanel({
        settings: { enabled: true },
        tui: { requestRender() {} },
        onChange: (next) => next,
        onClose() {},
        modelPicker: () => ({ render: () => [], invalidate() {} }),
        onWarning() {},
      }).render(width),
  },
];

for (const row of rows) {
  test(row.name, () => {
    for (const input of CORPUS) {
      for (const width of row.widths ?? WIDTHS) {
        const lines = row.render(input.text, width);
        try {
          assertFits(lines, width);
        } catch (error) {
          throw new Error(`corpus "${input.name}" at width ${width}: ${(error as Error).message}`);
        }
      }
    }
  });
}
