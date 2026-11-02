import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import {
  callLines,
  codemodeBody,
  codemodeCalls,
  codemodeMeta,
  codemodeSummary,
  errorTail,
  scriptLines,
  scriptOutput,
  scriptToolNames,
} from "./codemode.ts";

initTheme("dark");

const theme = testTheme();

function plain(lines: string[]): string[] {
  return lines.map(stripTerminalSequences);
}

const code = `const [readme, output] = await Promise.all([
  tools.read({ path: "README.md" }),
  tools.bash({ command: "seq 1 3" }),
]);
text(readme);
text(output.output);
`;

const details = {
  calls: [
    { id: "1", name: "read", args: '{"path":"README.md"}', status: "ok", durationMs: 4.9 },
    { id: "2", name: "bash", args: '{"command":"seq 1 3"}', status: "error", durationMs: 1200 },
  ],
};

const resultText = `Script completed
Wall time 0.1 seconds
Output:
# demo

A tiny project.
1
2
3
`;

test("the summary names the tools the script calls, in first-use order and once each", () => {
  assert.deepEqual(scriptToolNames(code), ["read", "bash"]);
  assert.deepEqual(scriptToolNames("tools.bash({}); tools.bash({}); tools.read({});"), ["bash", "read"]);
  assert.equal(codemodeSummary(code, []), "read, bash");
});

test("the summary falls back to the calls when the code names no tool", () => {
  assert.equal(codemodeSummary("text('hello');", codemodeCalls(details)), "read, bash");
  assert.equal(codemodeSummary("text('hello');", []), "");
});

test("the meta counts the calls and the failures", () => {
  assert.equal(codemodeMeta(codemodeCalls(details)), "2 calls · 1 failed");
  assert.equal(codemodeMeta([{ name: "read", args: "{}", status: "ok" }]), "1 call");
  assert.equal(codemodeMeta([]), undefined);
});

test("a running call from details parses like a finished one", () => {
  const calls = codemodeCalls({ calls: [{ id: "1", name: "read", args: '{"path":"a"}', status: "running" }] });
  assert.deepEqual(calls, [{ name: "read", args: '{"path":"a"}', status: "running", durationMs: undefined }]);
  assert.deepEqual(codemodeCalls({}), []);
  assert.deepEqual(codemodeCalls(undefined), []);
});

test("the output drops the script preamble and keeps the error text", () => {
  assert.deepEqual(scriptOutput(resultText), ["# demo", "", "A tiny project.", "1", "2", "3"]);

  const failed = "Script failed\nWall time 0.0 seconds\nOutput:\nbefore\nScript error:\nError: boom\n    at x\n";
  assert.deepEqual(scriptOutput(failed), ["before", "Script error:", "Error: boom", "    at x"]);

  // Pi joins the preamble part and the output part with a newline, which leaves a blank line between them.
  assert.deepEqual(scriptOutput("Script completed\nWall time 0.1 seconds\nOutput:\n\n# demo\n"), ["# demo"]);
  assert.deepEqual(scriptOutput("plain text"), ["plain text"]);
});

test("the collapsed failure keeps the last lines and counts the hidden ones", () => {
  assert.deepEqual(errorTail([1, 2, 3].map(String), 3), { lines: ["1", "2", "3"], hidden: 0 });
  assert.deepEqual(errorTail([1, 2, 3, 4, 5].map(String), 3), { lines: ["3", "4", "5"], hidden: 2 });
});

test("the script keeps every line, highlighted, and the options line", () => {
  const script = '// @options: {"timeout_ms": 60000}\ntext("hi");\n';
  const lines = scriptLines(script, 40);
  assert.equal(lines.length, 2);
  assert.equal(plain(lines)[0], '// @options: {"timeout_ms": 60000}');
  assert.equal(plain(lines)[1], 'text("hi");');
  assert.ok(lines[1].includes("\u001b["), "the script is not highlighted");
});

test("a long script line wraps instead of being cut", () => {
  const long = `const value = "${"x".repeat(80)}";`;
  const lines = plain(scriptLines(long, 40));
  assert.ok(lines.length > 1, lines.join("\n"));
  for (const line of lines) assert.ok(visibleWidth(line) <= 40, line);
});

test("an inner call is one row: status icon, name, args, duration", () => {
  const calls = codemodeCalls(details);
  const rows = plain(callLines(calls, 100, theme));
  assert.deepEqual(rows, ['✓ read {"path":"README.md"} 5ms', '✗ bash {"command":"seq 1 3"} 1.2s']);
  assert.equal(callLines(calls, 20, theme).length, 2);
  for (const row of plain(callLines(calls, 20, theme))) assert.ok(visibleWidth(row) <= 20, row);
});

test("the body is the script, the calls, then the output, cut to the width", () => {
  const calls = codemodeCalls(details);
  const output = scriptOutput(resultText);
  const rows = codemodeBody(code, calls, output, 40, theme);
  const text = plain(rows);

  assert.ok(text[0].startsWith("const [readme, output]"), text.join("\n"));
  for (const row of text) assert.ok(visibleWidth(row) <= 40, row);
  assert.ok(text.includes(""), "sections are not separated by a blank line");

  const firstCall = text.findIndex((row) => row.startsWith("✓ read"));
  const firstOutput = text.indexOf("# demo");
  assert.ok(firstCall > 0 && firstOutput > firstCall, text.join("\n"));
  assert.equal(text[firstCall - 1], "");
  assert.equal(text[firstOutput - 1], "");
  assert.ok(!text.some((row) => row.includes("Script completed")), text.join("\n"));
});

test("a body without calls still separates the script from the output", () => {
  const text = plain(codemodeBody('text("hi");', [], ["hi"], 40, theme));
  assert.deepEqual(text, ['text("hi");', "", "hi"]);
});
