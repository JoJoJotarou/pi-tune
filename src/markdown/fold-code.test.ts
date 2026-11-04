import assert from "node:assert/strict";
import { test } from "node:test";
import { getMarkdownTheme, initTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, stripTerminalSequences } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { foldLongCode } from "./fold-code.ts";

initTheme("dark", false);

const theme = testTheme("dark");

function codeLines(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `const value${index + 1} = ${index + 1};`);
}

function fence(lines: string[], fenceMark = "```", lang = "ts"): string[] {
  return [`${fenceMark}${lang}`, ...lines, fenceMark, ""];
}

const fold = (markdown: string): string => foldLongCode(markdown, theme);

const foldLine = (removed: number): string => theme.fg("dim", `┄ ${removed} more lines · alt+o to view`);

function visible(markdown: string, width = 80): string[] {
  return new Markdown(markdown, 0, 0, getMarkdownTheme())
    .render(width)
    .map((line) => stripTerminalSequences(line).trimEnd());
}

test("a block of 20 lines is untouched", () => {
  const input = ["Intro.", "", ...fence(codeLines(20)), "After.", ""].join("\n");
  assert.equal(fold(input), input);
});

test("a block of 21 lines keeps 12 lines and folds the other 9", () => {
  const lines = codeLines(21);
  const input = ["Intro.", "", ...fence(lines), "After.", ""].join("\n");
  const expected = ["Intro.", "", "```ts", ...lines.slice(0, 12), "```", foldLine(9), "", "After.", ""].join("\n");
  assert.equal(fold(input), expected);
});

test("mermaid fences are untouched", () => {
  const input = ["Intro.", "", ...fence(codeLines(21), "```", "mermaid"), "After.", ""].join("\n");
  assert.equal(fold(input), input);
});

test("tilde fences are folded with their own marker", () => {
  const lines = codeLines(24);
  const input = ["~~~ts", ...lines, "~~~", ""].join("\n");
  const output = fold(input);
  assert.ok(output.includes("~~~ts"), output);
  assert.ok(output.includes(`~~~\n${foldLine(12)}`), output);
  assert.ok(!output.includes("value13"), output);
});

test("a fence inside a list item is folded in place", () => {
  const lines = codeLines(21);
  const input = ["- Setup", "", "  ```ts", ...lines.map((line) => `  ${line}`), "  ```", "", "- Done", ""].join("\n");
  const expected = [
    "- Setup",
    "",
    "  ```ts",
    ...lines.slice(0, 12).map((line) => `  ${line}`),
    "  ```",
    `  ${foldLine(9)}`,
    "",
    "- Done",
    "",
  ].join("\n");
  assert.equal(fold(input), expected);
});

test("a fence in a blockquote is folded and every emitted line stays quoted", () => {
  const lines = codeLines(21);
  const input = ["> ```ts", ...lines.map((line) => `> ${line}`), "> ```", ""].join("\n");
  const expected = ["> ```ts", ...lines.slice(0, 12).map((line) => `> ${line}`), "> ```", `> ${foldLine(9)}`, ""].join(
    "\n",
  );
  assert.equal(fold(input), expected);
});

test("two long blocks in one message are both folded", () => {
  const first = codeLines(21).map((line) => line.replace("value", "alpha"));
  const second = codeLines(30).map((line) => line.replace("value", "beta"));
  const input = [...fence(first), "Between.", "", ...fence(second), "After.", ""].join("\n");
  const output = fold(input);
  assert.ok(output.includes(foldLine(9)), output);
  assert.ok(output.includes(foldLine(18)), output);
  assert.ok(output.includes("alpha12 = 12;"), output);
  assert.ok(!output.includes("alpha13 = 13;"), output);
  assert.ok(output.includes("beta12 = 12;"), output);
  assert.ok(!output.includes("beta13 = 13;"), output);
  assert.ok(output.includes("Between."), output);
});

test("rendering shows 12 code rows and the fold line", () => {
  const input = ["Intro.", "", ...fence(codeLines(30)), "After.", ""].join("\n");
  const lines = visible(fold(input));
  const codeRows = lines.filter((line) => /^const value\d+ = \d+;$/.test(line.trim()));
  assert.equal(codeRows.length, 12);
  assert.ok(
    lines.some((line) => line.includes("┄ 18 more lines · alt+o to view")),
    lines.join("\n"),
  );
  assert.ok(lines.includes("After."), lines.join("\n"));
});
