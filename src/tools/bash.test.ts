import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentToolResult, BashToolDetails } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";
import { exitCodeOf, failureTail, outputLines, summarizeCommand } from "./bash.ts";

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

test("outputLines drops Pi's exit-code trailer and the (no output) placeholder", async () => {
  const failed = await bashResult("sh -c 'seq 1 20; exit 3'");
  const text = resultText(failed);
  assert.ok(text.includes("Command exited with code 3"));
  const lines = outputLines(text);
  assert.equal(lines.length, 20);
  assert.ok(!lines.some((line) => line.includes("Command exited")));

  const empty = await bashResult("sh -c 'exit 3'");
  assert.match(resultText(empty), /^\(no output\)/);
  assert.deepEqual(outputLines(resultText(empty)), []);
});

test("failureTail keeps the last lines and counts the hidden ones", async () => {
  const short = await bashResult("sh -c 'seq 1 2; exit 3'");
  assert.deepEqual(failureTail(resultText(short), 3), { lines: ["1", "2"], hidden: 0 });

  const long = await bashResult("sh -c 'seq 1 20; exit 3'");
  assert.deepEqual(failureTail(resultText(long), 3), { lines: ["18", "19", "20"], hidden: 17 });
});
