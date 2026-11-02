import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createEditTool, initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import type { StructuredPatchHunk } from "diff";
import { testTheme } from "../../test/theme.ts";
import { diffStats, hunksFromPatch, hunksFromTexts, renderDiff } from "./diff.ts";

// highlightCode() reads the global theme; renderDiff() only gets one as an option.
initTheme("dark");

const DARK = testTheme("dark");
const LIGHT = testTheme("light");

const SERVER_TS = `import http from "node:http";

const PORT = 3000;
const HOST = "127.0.0.1";

function requestHandler(req, res) {
  res.setHeader("Content-Type", "text/plain");
  res.end("ok");
}

function startServer() {
  server.listen(PORT, HOST, () => {
    console.log("Server started .");
  });
}

const server = http.createServer(requestHandler);
startServer();
`;

const CONFIG_TS = `export const config = {
  port: 3000,
  host: "127.0.0.1",
};

export function url(path) {
  return \`http://\${config.host}:\${config.port}\${path}\`;
}
`;

const INSERT_TS = `function greet(name) {
  return \`hello \${name}\`;
}
`;

const DELETE_TS = `const limits = {
  min: 1,
  max: 10,
  step: 2,
};
`;

const BLANKS_TS = `const a = 1;

const b = 2;


const c = 3;
const d = 4;
const e = 5;
`;

const SINGULAR_TS = `const one = 1;
const two = 2;
const three = 3;
const four = 4;
const five = 5;
const six = 6;
const seven = 7;
const eight = 8;
`;

const LONG_TS = `export const message = "short";
export const other = 1;
`;

const TABS_TS = `function log() {
\tconsole.log("before");
}
`;

const UNKNOWN_TS = `alpha
beta
gamma
`;

const BIG_TS = `${Array.from({ length: 110 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n")}\n`;

interface Edit {
  oldText: string;
  newText: string;
}

interface RenderOptions {
  path: string;
  width?: number;
  theme?: ReturnType<typeof testTheme>;
  context?: number;
}

/** Applies `edits` with Pi's own edit tool, so the patch is a real one. */
async function patchFor(name: string, source: string, edits: Edit[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pi-tune-diff-"));
  const path = join(dir, name);
  await writeFile(path, source);
  const result = await createEditTool(dir).execute("test-call", { path, edits });
  const details = result.details;
  assert.ok(details, "the edit tool returned no details");
  return details.patch;
}

async function hunksFor(name: string, source: string, edits: Edit[]): Promise<StructuredPatchHunk[]> {
  return hunksFromPatch(await patchFor(name, source, edits));
}

function render(hunks: StructuredPatchHunk[], options: RenderOptions): string[] {
  const { path, width = 100, theme = DARK, context } = options;
  return renderDiff(hunks, { path, width, theme, context });
}

/** ANSI-free lines, trailing padding removed: the layout the user reads. */
function plain(lines: string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line).trimEnd());
}

interface BgSpan {
  bg: string;
  text: string;
}

/** Splits a raw line into visible text runs tagged with the SGR background in effect. */
function bgSpans(line: string): BgSpan[] {
  const spans: BgSpan[] = [];
  const sgr = new RegExp(`${String.fromCharCode(27)}\\[([0-9;:]*)m`, "g");
  let bg = "default";
  let text = "";
  let cursor = 0;
  for (let match = sgr.exec(line); match; match = sgr.exec(line)) {
    text += line.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const previous = bg;
    const params = match[1]
      .split(";")
      .filter((part) => part !== "")
      .map(Number);
    for (let index = 0; index < params.length; index++) {
      const code = params[index];
      if (code === 0 || code === 49) {
        bg = "default";
      } else if (code === 48) {
        const kind = params[index + 1];
        if (kind === 2) {
          bg = `48;2;${params[index + 2]};${params[index + 3]};${params[index + 4]}`;
          index += 4;
        } else if (kind === 5) {
          bg = `48;5;${params[index + 2]}`;
          index += 2;
        } else {
          index += 1;
        }
      } else if (code === 38) {
        const kind = params[index + 1];
        if (kind === 2) index += 4;
        else if (kind === 5) index += 2;
        else index += 1;
      }
    }
    if (text !== "") spans.push({ bg: previous, text });
    text = "";
  }
  text += line.slice(cursor);
  if (text !== "") spans.push({ bg, text });
  const merged: BgSpan[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last !== undefined && last.bg === span.bg) last.text += span.text;
    else merged.push({ ...span });
  }
  return merged;
}

function tintedSpans(line: string): BgSpan[] {
  return bgSpans(line).filter((span) => span.bg !== "default");
}

/** Width covered by a non-default background; a tinted row must cover the full width. */
function tintWidth(line: string): number {
  return tintedSpans(line).reduce((total, span) => total + visibleWidth(span.text), 0);
}

/** The tint of the row itself, i.e. the one painted under most of the line. */
function rowTint(line: string): string {
  const spans = tintedSpans(line);
  assert.ok(spans.length > 0, "row has no background tint");
  return spans.reduce((best, span) => (visibleWidth(span.text) > visibleWidth(best.text) ? span : best)).bg;
}

function changedWords(line: string): string {
  const tint = rowTint(line);
  return tintedSpans(line)
    .filter((span) => span.bg !== tint)
    .map((span) => span.text)
    .join("");
}

function assertFits(lines: string[], width: number): void {
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= width, `line wider than ${width}: ${JSON.stringify(stripTerminalSequences(line))}`);
  }
}

test("removed rows show only the old number, added rows only the new number", async () => {
  const hunks = await hunksFor("config.ts", CONFIG_TS, [{ oldText: "  port: 3000,", newText: "  port: 4000," }]);
  const lines = plain(render(hunks, { path: "config.ts", width: 100 }));

  assert.deepEqual(lines, [
    "1 1 │ export const config = {",
    "2   │-  port: 3000,",
    "  2 │+  port: 4000,",
    '3 3 │   host: "127.0.0.1",',
  ]);
  assert.match(lines[1], /^2 +│-/);
  assert.match(lines[2], /^ +2 │\+/);
});

test("three-digit line numbers widen both columns and shorter numbers align in them", async () => {
  const hunks = await hunksFor("big.ts", BIG_TS, [
    { oldText: "const value5 = 5;", newText: "const value5 = 50;" },
    { oldText: "const value104 = 104;", newText: "const value104 = 1040;" },
  ]);
  const lines = plain(render(hunks, { path: "big.ts", width: 100 }));

  assert.deepEqual(lines, [
    "  4   4 │ const value4 = 4;",
    "  5     │-const value5 = 5;",
    "      5 │+const value5 = 50;",
    "  6   6 │ const value6 = 6;",
    "┄ 96 unchanged lines",
    "103 103 │ const value103 = 103;",
    "104     │-const value104 = 104;",
    "    104 │+const value104 = 1040;",
    "105 105 │ const value105 = 105;",
  ]);
});

test("context defaults to one line on each side of every change", async () => {
  const hunks = await hunksFor("server.ts", SERVER_TS, [
    { oldText: "const PORT = 3000;", newText: "const PORT = Number(process.env.PORT ?? 3000);" },
    { oldText: '    console.log("Server started .");', newText: "    console.log(`Server started on port ${PORT}.`);" },
  ]);
  const lines = plain(render(hunks, { path: "server.ts", width: 100 }));

  assert.deepEqual(lines, [
    ' 1  1 │ import http from "node:http";',
    " 2  2 │",
    " 3    │-const PORT = 3000;",
    "    3 │+const PORT = Number(process.env.PORT ?? 3000);",
    ' 4  4 │ const HOST = "127.0.0.1";',
    "┄ 7 unchanged lines",
    "12 12 │   server.listen(PORT, HOST, () => {",
    '13    │-    console.log("Server started .");',
    "   13 │+    console.log(`Server started on port ${PORT}.`);",
    "14 14 │   });",
  ]);
});

test("a wider context option keeps that many lines around each change", async () => {
  const hunks = await hunksFor("server.ts", SERVER_TS, [
    { oldText: "const PORT = 3000;", newText: "const PORT = Number(process.env.PORT ?? 3000);" },
    { oldText: '    console.log("Server started .");', newText: "    console.log(`Server started on port ${PORT}.`);" },
  ]);
  const lines = plain(render(hunks, { path: "server.ts", width: 100, context: 3 }));

  assert.deepEqual(lines, [
    ' 1  1 │ import http from "node:http";',
    " 2  2 │",
    " 3    │-const PORT = 3000;",
    "    3 │+const PORT = Number(process.env.PORT ?? 3000);",
    ' 4  4 │ const HOST = "127.0.0.1";',
    " 5  5 │",
    " 6  6 │ function requestHandler(req, res) {",
    ' 7  7 │   res.setHeader("Content-Type", "text/plain");',
    "┄ 1 unchanged line",
    " 9  9 │ }",
    "10 10 │",
    "11 11 │ function startServer() {",
    "12 12 │   server.listen(PORT, HOST, () => {",
    '13    │-    console.log("Server started .");',
    "   13 │+    console.log(`Server started on port ${PORT}.`);",
    "14 14 │   });",
    "15 15 │ }",
    "16 16 │",
    "17 17 │ const server = http.createServer(requestHandler);",
  ]);
});

test("blank lines are shown but do not count toward the context budget", async () => {
  const hunks = await hunksFor("blanks.ts", BLANKS_TS, [{ oldText: "const b = 2;", newText: "const b = 20;" }]);
  const lines = plain(render(hunks, { path: "blanks.ts", width: 100 }));

  assert.deepEqual(lines, [
    "1 1 │ const a = 1;",
    "2 2 │",
    "3   │-const b = 2;",
    "  3 │+const b = 20;",
    "4 4 │",
    "5 5 │",
    "6 6 │ const c = 3;",
  ]);
});

test("a single hidden line between regions gets a singular marker", async () => {
  const hunks = await hunksFor("singular.ts", SINGULAR_TS, [
    { oldText: "const two = 2;", newText: "const two = 20;" },
    { oldText: "const six = 6;", newText: "const six = 60;" },
  ]);
  const lines = plain(render(hunks, { path: "singular.ts", width: 100 }));

  assert.deepEqual(lines, [
    "1 1 │ const one = 1;",
    "2   │-const two = 2;",
    "  2 │+const two = 20;",
    "3 3 │ const three = 3;",
    "┄ 1 unchanged line",
    "5 5 │ const five = 5;",
    "6   │-const six = 6;",
    "  6 │+const six = 60;",
    "7 7 │ const seven = 7;",
  ]);
});

test("a pure deletion drops rows and marks nothing before the first region", async () => {
  const hunks = await hunksFor("delete.ts", DELETE_TS, [{ oldText: "  step: 2,\n", newText: "" }]);
  const lines = plain(render(hunks, { path: "delete.ts", width: 100 }));

  assert.deepEqual(lines, ["3 3 │   max: 10,", "4   │-  step: 2,", "5 5 │ };"]);
  assert.ok(
    lines.every((line) => !line.startsWith("┄")),
    "no marker before the first or after the last region",
  );
  assert.ok(
    lines.every((line) => !line.includes("│+")),
    "a deletion adds no rows",
  );
});

test("a pure insertion adds rows with only the new number", async () => {
  const hunks = await hunksFor("insert.ts", INSERT_TS, [
    { oldText: "function greet(name) {\n", newText: "function greet(name) {\n  const trimmed = name.trim();\n" },
  ]);
  const lines = plain(render(hunks, { path: "insert.ts", width: 100 }));

  assert.deepEqual(lines, [
    "1 1 │ function greet(name) {",
    "  2 │+  const trimmed = name.trim();",
    "3 3 │   return `hello ${name}`;",
  ]);
  assert.ok(
    lines.every((line) => !line.includes("│-")),
    "an insertion removes no rows",
  );
});

test("diffStats counts added and removed lines", async () => {
  const inserted = await hunksFor("insert.ts", INSERT_TS, [
    { oldText: "function greet(name) {\n", newText: "function greet(name) {\n  const trimmed = name.trim();\n" },
  ]);
  const deleted = await hunksFor("delete.ts", DELETE_TS, [{ oldText: "  step: 2,\n", newText: "" }]);
  const mixed = await hunksFor("server.ts", SERVER_TS, [
    { oldText: "const PORT = 3000;", newText: "const PORT = Number(process.env.PORT ?? 3000);" },
    { oldText: '    console.log("Server started .");', newText: "    console.log(`Server started on port ${PORT}.`);" },
  ]);

  assert.deepEqual(diffStats(inserted), { added: 1, removed: 0 });
  assert.deepEqual(diffStats(deleted), { added: 0, removed: 1 });
  assert.deepEqual(diffStats(mixed), { added: 2, removed: 2 });
  assert.deepEqual(diffStats([]), { added: 0, removed: 0 });
});

test("hunksFromPatch reads the hunks of the first file only", async () => {
  const serverPatch = await patchFor("server.ts", SERVER_TS, [
    { oldText: "const PORT = 3000;", newText: "const PORT = Number(process.env.PORT ?? 3000);" },
    { oldText: '    console.log("Server started .");', newText: "    console.log(`Server started on port ${PORT}.`);" },
  ]);
  const configPatch = await patchFor("config.ts", CONFIG_TS, [{ oldText: "  port: 3000,", newText: "  port: 4000," }]);

  const hunks = hunksFromPatch(serverPatch);
  assert.equal(hunks.length, 2);
  assert.equal(hunks[0].oldStart, 1);
  assert.equal(hunks[1].oldStart, 9);

  const first = hunksFromPatch(`${serverPatch}${configPatch}`);
  assert.equal(first.length, 2);
  assert.ok(first.every((hunk) => hunk.lines.every((line) => !line.includes("port: 4000"))));
});

test("hunksFromTexts keeps three context lines by default", () => {
  const hunks = hunksFromTexts(CONFIG_TS, CONFIG_TS.replace("  port: 3000,", "  port: 4000,"));

  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].oldStart, 1);
  assert.equal(hunks[0].oldLines, 5);
  assert.equal(hunks[0].newStart, 1);
  assert.equal(hunks[0].newLines, 5);
  assert.deepEqual(hunks[0].lines, [
    " export const config = {",
    "-  port: 3000,",
    "+  port: 4000,",
    '   host: "127.0.0.1",',
    " };",
    " ",
  ]);
});

test("hunksFromTexts honors the context argument", () => {
  const newText = CONFIG_TS.replace("  port: 3000,", "  port: 4000,");

  const tight = hunksFromTexts(CONFIG_TS, newText, 0);
  assert.deepEqual(tight[0].lines, ["-  port: 3000,", "+  port: 4000,"]);
  assert.equal(tight[0].oldLines, 1);
  assert.equal(tight[0].newLines, 1);

  const one = hunksFromTexts(CONFIG_TS, newText, 1);
  assert.deepEqual(one[0].lines, [
    " export const config = {",
    "-  port: 3000,",
    "+  port: 4000,",
    '   host: "127.0.0.1",',
  ]);

  assert.deepEqual(hunksFromTexts(CONFIG_TS, CONFIG_TS), []);
});

test("long lines wrap with blank number columns, keeping the bar", async () => {
  const hunks = await hunksFor("long.ts", LONG_TS, [
    {
      oldText: 'export const message = "short";',
      newText: 'export const message = "a much longer message that will not fit on one rendered row";',
    },
  ]);
  const width = 40;
  const lines = render(hunks, { path: "long.ts", width });
  const layout = plain(lines);

  assertFits(lines, width);
  assert.equal(layout.length, 5);
  assert.equal(layout[0], '1   │-export const message = "short";');
  assert.equal(layout[4], "2 2 │ export const other = 1;");
  assert.match(layout[1], /^ {2}1 │\+/);
  for (const continuation of layout.slice(2, 4)) {
    assert.match(continuation, /^ {4}│/, "continuation rows blank the number columns and keep the bar");
  }

  const code = layout.map((line) => line.slice(line.indexOf("│") + 1)).join("");
  assert.ok(code.includes('"a much longer message'), "the start of the wrapped line is kept");
  assert.ok(code.includes('one rendered row";'), "the end of the wrapped line is kept");
  for (const line of lines.slice(0, 4)) {
    assert.equal(tintWidth(line), width, "wrapped rows keep the row background across the full width");
  }
});

test("tabs expand to three spaces", async () => {
  const hunks = await hunksFor("tabs.ts", TABS_TS, [
    { oldText: '\tconsole.log("before");', newText: '\tconsole.log("after");' },
  ]);
  const lines = render(hunks, { path: "tabs.ts", width: 100 });

  assert.deepEqual(plain(lines), [
    "1 1 │ function log() {",
    '2   │-   console.log("before");',
    '  2 │+   console.log("after");',
    "3 3 │ }",
  ]);
  for (const line of lines) assert.ok(!line.includes("\t"), "no tab survives rendering");
});

test("changed rows are tinted to the full width, with no inverse video", async () => {
  const hunks = await hunksFor("config.ts", CONFIG_TS, [{ oldText: "  port: 3000,", newText: "  port: 4000," }]);
  const width = 60;
  const lines = render(hunks, { path: "config.ts", width });
  const [contextBefore, removed, added, contextAfter] = lines;

  assert.ok(
    lines.every((line) => !line.includes("\x1b[7m")),
    "no inverse video",
  );
  assert.equal(visibleWidth(stripTerminalSequences(removed)), width);
  assert.equal(visibleWidth(stripTerminalSequences(added)), width);
  assert.equal(tintWidth(removed), width);
  assert.equal(tintWidth(added), width);
  assert.notEqual(rowTint(removed), rowTint(added), "removed and added rows get different tints");
  assert.deepEqual(tintedSpans(contextBefore), []);
  assert.deepEqual(tintedSpans(contextAfter), []);
});

test("changed words get a stronger tint than the rest of their row", async () => {
  const hunks = await hunksFor("config.ts", CONFIG_TS, [{ oldText: "  port: 3000,", newText: "  port: 4000," }]);
  const [, removed, added] = render(hunks, { path: "config.ts", width: 60 });

  assert.notEqual(changedWords(removed), "");
  assert.ok(changedWords(removed).includes("3000"), "the old word is marked in the removed row");
  assert.ok(changedWords(added).includes("4000"), "the new word is marked in the added row");
  assert.ok(tintedSpans(removed).length >= 2);
  assert.ok(tintedSpans(added).length >= 2);
});

test("dark and light themes render the same layout with their own tints", async () => {
  const hunks = await hunksFor("config.ts", CONFIG_TS, [{ oldText: "  port: 3000,", newText: "  port: 4000," }]);
  const width = 60;
  const dark = render(hunks, { path: "config.ts", width, theme: DARK });
  const light = render(hunks, { path: "config.ts", width, theme: LIGHT });

  assert.deepEqual(plain(dark), plain(light));
  assertFits(dark, width);
  assertFits(light, width);
  assert.equal(tintWidth(dark[1]), width);
  assert.equal(tintWidth(light[1]), width);
  assert.notEqual(rowTint(dark[1]), rowTint(light[1]), "each theme tints with its own colors");
});

test("an unknown file extension still renders", async () => {
  const hunks = await hunksFor("notes.unknownext", UNKNOWN_TS, [{ oldText: "beta", newText: "delta" }]);
  const lines = render(hunks, { path: "notes.unknownext", width: 100 });

  assert.deepEqual(plain(lines), ["1 1 │ alpha", "2   │-beta", "  2 │+delta", "3 3 │ gamma"]);
  assertFits(lines, 100);
});

test("no rendered line is wider than the width, at 100, 60 and 40", async () => {
  const cases: Array<{ name: string; source: string; edits: Edit[] }> = [
    {
      name: "server.ts",
      source: SERVER_TS,
      edits: [
        { oldText: "const PORT = 3000;", newText: "const PORT = Number(process.env.PORT ?? 3000);" },
        {
          oldText: '    console.log("Server started .");',
          newText: "    console.log(`Server started on port ${PORT}.`);",
        },
      ],
    },
    {
      name: "big.ts",
      source: BIG_TS,
      edits: [
        { oldText: "const value5 = 5;", newText: "const value5 = 50;" },
        { oldText: "const value104 = 104;", newText: "const value104 = 1040;" },
      ],
    },
    {
      name: "long.ts",
      source: LONG_TS,
      edits: [
        {
          oldText: 'export const message = "short";',
          newText: 'export const message = "a much longer message that will not fit on one rendered row";',
        },
      ],
    },
    { name: "config.ts", source: CONFIG_TS, edits: [{ oldText: "  port: 3000,", newText: "  port: 4000," }] },
  ];

  for (const { name, source, edits } of cases) {
    const hunks = await hunksFor(name, source, edits);
    for (const width of [100, 60, 40]) {
      const lines = render(hunks, { path: name, width });
      assert.ok(lines.length > 0);
      assertFits(lines, width);
      for (const line of lines) {
        assert.ok(!line.includes("\x1b[7m"), "no inverse video");
      }
    }
  }
});
