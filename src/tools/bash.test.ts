import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentToolResult, BashToolDetails } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { exitCodeOf, failureExcerpt, summarizeCommand } from "./bash.ts";

const cwd = mkdtempSync(join(tmpdir(), "pi-tune-bash-"));
const bash = createBashTool(cwd);

type BashResult = AgentToolResult<BashToolDetails | undefined>;

async function bashResult(command: string): Promise<BashResult> {
  return bash.execute("bash-test", { command });
}

function resultText(result: BashResult): string {
  return result.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

test("summarizeCommand keeps the first line and counts the rest", () => {
  assert.deepEqual(summarizeCommand("seq 1 40"), { first: "seq 1 40", extraLines: 0 });
  assert.deepEqual(summarizeCommand("seq 1 40\n"), { first: "seq 1 40", extraLines: 0 });
  assert.deepEqual(summarizeCommand("echo one\necho two\necho three"), {
    first: "echo one",
    extraLines: 2,
  });
  assert.deepEqual(summarizeCommand("cat <<'EOF'\nline one\nline two\nEOF"), {
    first: "cat <<'EOF'",
    extraLines: 3,
  });
  assert.deepEqual(summarizeCommand(""), { first: "", extraLines: 0 });
});

test("exitCodeOf reads the exit code from Pi's bash error text", async () => {
  const failed = await bashResult("sh -c 'seq 1 20; exit 3'");
  assert.equal(exitCodeOf(resultText(failed)), 3);
  const other = await bashResult("sh -c 'exit 137'");
  assert.equal(exitCodeOf(resultText(other)), 137);
  const succeeded = await bashResult("seq 1 40");
  assert.equal(exitCodeOf(resultText(succeeded)), undefined);
});

test("failureExcerpt returns output of at most 6 lines whole", async () => {
  const result = await bashResult("sh -c 'seq 1 6; exit 3'");
  assert.deepEqual(failureExcerpt(resultText(result), "ctrl+o"), ["1", "2", "3", "4", "5", "6"]);
});

test("failureExcerpt folds longer output after the first 2 lines", async () => {
  const result = await bashResult("sh -c 'seq 1 7; exit 3'");
  assert.deepEqual(failureExcerpt(resultText(result), "ctrl+o"), [
    "1",
    "2",
    "┄ 2 lines folded · ctrl+o",
    "5",
    "6",
    "7",
  ]);
});

test("failureExcerpt leaves Pi's exit-code trailer out of the output", async () => {
  const result = await bashResult("sh -c 'seq 1 20; exit 3'");
  const text = resultText(result);
  assert.ok(text.includes("Command exited with code 3"));
  const lines = failureExcerpt(text, "ctrl+o");
  assert.equal(lines.length, 6);
  assert.equal(lines[2], "┄ 15 lines folded · ctrl+o");
  assert.ok(!lines.some((line) => line.includes("Command exited")));
});
