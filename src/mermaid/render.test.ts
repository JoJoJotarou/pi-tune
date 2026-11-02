import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type ExtensionAPI, type ExtensionContext, getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import { render } from "grok-mermaid";
import mermaidExtension from "../../extensions/mermaid.ts";
import { testTheme } from "../../test/theme.ts";
import { previewFile } from "./preview-file.ts";
import { mermaidMarkdown, previewHtml } from "./render.ts";

initTheme("dark", false);

const theme = testTheme("dark");
const url = "file:///tmp/pi-tune-mermaid/abc.html";
const flowchart = "flowchart TD\n  A[Start] --> B{Check}\n  B --> C[Done]";
const fence = "```mermaid\nflowchart TD\n  A[Start] --> B{Check}\n  B --> C[Done]\n```\n";

function visible(markdown: string, width = 100): string[] {
  return new Markdown(markdown, 0, 0, getMarkdownTheme())
    .render(width)
    .map((line) => stripTerminalSequences(line).trimEnd());
}

interface Notice {
  message: string;
  type: string | undefined;
}

interface Wiring {
  transformer: ((markdown: string, context: Record<string, unknown>) => string) | undefined;
  notices: Notice[];
  end(message: unknown): void;
}

function load(settings: Record<string, unknown>): Wiring {
  let onSessionStart: ((event: unknown, ctx: ExtensionContext) => void) | undefined;
  let onMessageEnd: ((event: unknown, ctx: ExtensionContext) => void) | undefined;
  let transformer: Wiring["transformer"];
  const notices: Notice[] = [];
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => void) => {
      if (event === "session_start") onSessionStart = handler;
      if (event === "message_end") onMessageEnd = handler;
    },
    registerMarkdownTransformer: (fn: NonNullable<Wiring["transformer"]>) => {
      transformer = fn;
    },
    getSettings: () => settings,
  };
  mermaidExtension(pi as unknown as ExtensionAPI);
  const ctx = {
    ui: {
      theme,
      notify: (message: string, type?: string) => notices.push({ message, type }),
    },
  } as unknown as ExtensionContext;
  onSessionStart?.({}, ctx);
  return { transformer, notices, end: (message) => onMessageEnd?.({ type: "message_end", message }, ctx) };
}

test("a diagram that fits renders art rows as code spans and the action row", () => {
  const out = mermaidMarkdown(flowchart, 100, theme, url);
  assert.ok(out);
  const art = render(flowchart);
  assert.ok(art);
  const rows = out.split("\n").filter((line) => line.startsWith("` "));
  assert.equal(rows.length, art.styled.length);
  for (const row of rows) assert.ok(row.startsWith("` ") && row.trimEnd().endsWith("`"), row);
  assert.ok(!out.includes("```"));
  assert.ok(out.includes(`[open preview](${url})`));
  assert.ok(out.includes(theme.fg("dim", "◇ mermaid · flowchart")));
  assert.ok(out.includes(theme.fg("dim", "· alt+o source")));
  assert.ok(out.includes(theme.fg("borderMuted", "┌───────┐")));
  assert.ok(out.includes(theme.fg("text", "Start")));
  assert.ok(out.includes(theme.fg("accent", "▼")));
});

test("a diagram wider than the space shows the needs line and no art", () => {
  const out = mermaidMarkdown(flowchart, 5, theme, url);
  assert.ok(out);
  assert.ok(out.includes(theme.fg("dim", "◇ mermaid · flowchart · needs 10 columns, have 5")));
  assert.ok(!out.includes("┌"));
  assert.ok(out.includes(`[open preview](${url})`));
});

test("an unsupported or invalid source leaves the fence alone", () => {
  assert.equal(mermaidMarkdown('pie\n  "a": 1', 100, theme, url), undefined);
  assert.equal(mermaidMarkdown("", 100, theme, url), undefined);
});

test("the preview page escapes the source and pins the CDN URL", () => {
  const html = previewHtml("flowchart TD\n  A[\"<tag> & 'quoted'\"]");
  assert.ok(html.includes("&lt;tag&gt;"));
  assert.ok(html.includes("&amp;"));
  assert.ok(html.includes("&quot;"));
  assert.ok(html.includes("&#39;"));
  assert.ok(!html.includes("<tag>"));
  assert.ok(html.includes('<pre class="mermaid">'));
  assert.ok(html.includes("https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js"));
});

test("the preview file is written once per source and returns a file URL", () => {
  const source = "flowchart TD\n  A[Only] --> B[Once]";
  const first = previewFile(source);
  const second = previewFile(source);
  assert.equal(first, second);
  assert.ok(first.startsWith("file://"));
  assert.ok(readFileSync(new URL(first), "utf8").includes("mermaid.min.js"));
});

test("rendered art keeps each row on its own line with its spacing", () => {
  const out = mermaidMarkdown(flowchart, 100, theme, url);
  assert.ok(out);
  const lines = visible(out);
  assert.deepEqual(lines.slice(0, 3), [" ┌───────┐", " │ Start │", " └───┬───┘"]);
  assert.equal(lines[3], "     │");
  assert.ok(lines.some((line) => line.includes("◇ mermaid · flowchart")));
  assert.ok(lines.some((line) => line.includes("open preview")));
});

test("the transformer replaces mermaid fences only in finished assistant messages", () => {
  const { transformer, notices } = load({ markdown: { mermaid: "off" } });
  assert.deepEqual(notices, []);
  assert.ok(transformer);
  const context = { messageType: "assistant", isStreaming: false, availableWidth: 100 };
  const out = transformer(fence, context);
  assert.ok(out.includes("◇ mermaid · flowchart"));
  assert.ok(!out.includes("```mermaid"));
  assert.equal(transformer(fence, { ...context, isStreaming: true }), fence);
  assert.equal(transformer(fence, { ...context, messageType: "user" }), fence);
  const ts = "```ts\nconst a = 1;\n```\n";
  assert.equal(transformer(ts, context), ts);
  const unsupported = '```mermaid\npie\n  "a": 1\n```\n';
  assert.equal(transformer(unsupported, context), unsupported);
});

test("without mermaid off a mermaid answer gets one info notice and no transformer", () => {
  const { transformer, notices, end } = load({});
  assert.equal(transformer, undefined);
  assert.deepEqual(notices, []);
  const answer = { role: "assistant", content: [{ type: "text", text: fence }] };
  end(answer);
  assert.deepEqual(notices, [
    {
      message: 'pi-tune: set "markdown": { "mermaid": "off" } in Pi settings for diagram previews and source copy',
      type: "info",
    },
  ]);
  end(answer);
  assert.equal(notices.length, 1);
});

test("answers without a mermaid fence get no notice", () => {
  const { notices, end } = load({});
  end({ role: "assistant", content: [{ type: "text", text: "```ts\nconst a = 1;\n```\n" }] });
  end({ role: "user", content: [{ type: "text", text: fence }] });
  assert.deepEqual(notices, []);
});
