import assert from "node:assert/strict";
import { test } from "node:test";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { appendLinkDomains, rewriteHeadings, tablesToLists } from "./rewrite.ts";

initTheme("dark", false);

const theme = testTheme("dark");

function dim(host: string): string {
  return theme.fg("dim", `↗ ${host}`);
}

function render(markdown: string, width = 80): string[] {
  return new Markdown(markdown, 0, 0, getMarkdownTheme()).render(width);
}

function visible(markdown: string, width = 80): string[] {
  return render(markdown, width).map((line) => stripTerminalSequences(line).trimEnd());
}

const wideTable = [
  "| Tool | Language | UI | Grouping |",
  "|---|---|---|---|",
  "| Grok Build | Rust | ratatui | verb group |",
  "| Codex CLI | Rust | ratatui | Explored |",
  "",
].join("\n");

const wideTableList = [
  "- **Grok Build** — Language: Rust · UI: ratatui · Grouping: verb group",
  "- **Codex CLI** — Language: Rust · UI: ratatui · Grouping: Explored",
].join("\n");

test("H3–H6 headings become bold paragraphs followed by a blank line", () => {
  assert.equal(rewriteHeadings("### Three"), "**Three**\n\n");
  assert.equal(rewriteHeadings("#### Four"), "**Four**\n\n");
  assert.equal(rewriteHeadings("##### Five"), "**Five**\n\n");
  assert.equal(rewriteHeadings("###### Six"), "**Six**\n\n");
});

test("heading inline content is kept inside the bold paragraph", () => {
  assert.equal(
    rewriteHeadings("### Use `code`, *em* and [a link](https://example.com)"),
    "**Use `code`, *em* and [a link](https://example.com)**\n\n",
  );
});

test("H1, H2 and setext headings are untouched", () => {
  const input = "# One\n\n## Two\n\nSetext one\n==========\n\nSetext two\n----------\n";
  assert.equal(rewriteHeadings(input), input);
});

test("headings inside fenced, indented and inline code are untouched", () => {
  const input = "```\n### inside fence\n```\n\n    ### inside indent\n\nUse `### inline` here.\n";
  assert.equal(rewriteHeadings(input), input);
});

test("a rewritten heading renders as a title line without hashes", () => {
  const lines = visible(rewriteHeadings("### Setup\n\nRun it."));
  assert.equal(lines[0], "Setup");
  assert.ok(!lines.join("\n").includes("###"));
  assert.ok(lines.includes("Run it."));
});

test("a heading directly followed by a list renders as a bold line and a list", () => {
  const lines = visible(rewriteHeadings("### Setup\n- one\n- two"));
  assert.deepEqual(lines, ["Setup", "", "- one", "- two"]);
});

test("http and https links get their host appended", () => {
  assert.equal(
    appendLinkDomains("[docs](https://example.com/page)", theme),
    `[docs](https://example.com/page) ${dim("example.com")}`,
  );
  assert.equal(
    appendLinkDomains("[docs](http://example.com/page)", theme),
    `[docs](http://example.com/page) ${dim("example.com")}`,
  );
});

test("www. is stripped from the appended host", () => {
  assert.equal(
    appendLinkDomains("[docs](https://www.example.com/a)", theme),
    `[docs](https://www.example.com/a) ${dim("example.com")}`,
  );
});

test("links whose text is the URL or the host get no host", () => {
  const inputs = [
    "[https://example.com](https://example.com)",
    "<https://example.com>",
    "[example.com](https://example.com)",
    "[ example.com ](https://example.com)",
  ];
  for (const input of inputs) {
    assert.equal(appendLinkDomains(input, theme), input);
  }
});

test("relative, mailto and image links get no host", () => {
  const inputs = [
    "[guide](/docs/x)",
    "[anchor](#section)",
    "[mail](mailto:a@example.com)",
    "![img](https://example.com/a.png)",
  ];
  for (const input of inputs) {
    assert.equal(appendLinkDomains(input, theme), input);
  }
});

test("links inside code get no host", () => {
  const input = "```\n[docs](https://example.com)\n```\n\nUse `[docs](https://example.com)` here.\n";
  assert.equal(appendLinkDomains(input, theme), input);
});

test("every link on one line gets its own host", () => {
  assert.equal(
    appendLinkDomains("[a](https://a.com) and [b](http://www.b.org/x)", theme),
    `[a](https://a.com) ${dim("a.com")} and [b](http://www.b.org/x) ${dim("b.org")}`,
  );
});

test("an appended host renders dimmed after the link", () => {
  const out = appendLinkDomains("See [docs](https://example.com) now.", theme);
  assert.ok(render(out)[0]?.includes(dim("example.com")));
  assert.equal(visible(out)[0], "See docs ↗ example.com now.");
});

test("a table that fits the width is untouched", () => {
  const narrow = "| A | B |\n|---|---|\n| x | y |\n";
  assert.equal(tablesToLists(narrow, 9), narrow);
  assert.equal(tablesToLists(narrow, 80), narrow);
  assert.equal(tablesToLists(wideTable, 48), wideTable);
});

test("a table wider than the width becomes a list", () => {
  const out = tablesToLists(wideTable, 40);
  assert.equal(out.trimEnd(), wideTableList);
  assert.ok(!out.includes("|"));
});

test("empty cells are skipped in the list form", () => {
  const table = "| Tool | Language | Grouping |\n|---|---|---|\n| Codex CLI |  | Explored |\n";
  assert.equal(tablesToLists(table, 20).trimEnd(), "- **Codex CLI** — Grouping: Explored");
});

test("inline markers are not counted when measuring a table", () => {
  const table = "| A | B |\n|---|---|\n| x | **bold** |\n";
  assert.equal(tablesToLists(table, 12), table);
  assert.equal(tablesToLists(table, 11).trimEnd(), "- **x** — B: bold");
});

test("CJK cells are measured in terminal columns", () => {
  const table = "| 名 | 值 |\n|---|---|\n| 中文 | 中文中文 |\n";
  assert.equal(tablesToLists(table, 19), table);
  assert.equal(tablesToLists(table, 18).trimEnd(), "- **中文** — 值: 中文中文");
});

test("tables inside code blocks are untouched", () => {
  const input = "```\n| A | B |\n|---|---|\n| x | y |\n```\n";
  assert.equal(tablesToLists(input, 5), input);
});

test("text around a rewritten table is unchanged", () => {
  const out = tablesToLists(`Intro\n\n${wideTable}\nOutro\n`, 40);
  assert.ok(out.startsWith("Intro\n\n- **Grok Build**"));
  assert.ok(out.endsWith("\n\nOutro\n"));
  assert.ok(!out.includes("|"));
});

test("a rewritten table renders as list lines", () => {
  assert.deepEqual(visible(tablesToLists(wideTable, 40)), [
    "- Grok Build — Language: Rust · UI: ratatui · Grouping: verb group",
    "- Codex CLI — Language: Rust · UI: ratatui · Grouping: Explored",
  ]);
});

test("a link in a nested list item whose paragraph spans two lines gets its host", () => {
  const input = [
    "- top",
    "  - nested",
    "    Read the [docs](https://example.com/guide)",
    "    before you start.",
    "",
  ].join("\n");
  const expected = input.replace(
    "[docs](https://example.com/guide)",
    `[docs](https://example.com/guide) ${dim("example.com")}`,
  );
  assert.equal(appendLinkDomains(input, theme), expected);
});
