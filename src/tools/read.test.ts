import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentToolResult, ReadToolDetails } from "@earendil-works/pi-coding-agent";
import { createReadTool } from "@earendil-works/pi-coding-agent";
import { readMeta, skillLabel } from "./read.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-tune-read-meta-"));
writeFileSync(join(dir, "three.txt"), "alpha\nbeta\ngamma\n");
writeFileSync(join(dir, "one.txt"), "only\n");
// 3400 lines without a trailing newline: Pi's own totals then match the file
writeFileSync(join(dir, "flat.txt"), Array.from({ length: 3400 }, (_, i) => `line ${i + 1}`).join("\n"));

const read = createReadTool(dir);

async function readResult(args: { path: string; offset?: number; limit?: number }) {
  return read.execute("read-meta-test", args);
}

function meta(
  args: { path: string; offset?: number; limit?: number },
  result: AgentToolResult<ReadToolDetails | undefined>,
) {
  return readMeta(args, result);
}

test("a whole file read shows the number of lines it returned", async () => {
  const args = { path: "three.txt" };
  assert.equal(meta(args, await readResult(args)), "3 lines");

  const oneArgs = { path: "one.txt" };
  assert.equal(meta(oneArgs, await readResult(oneArgs)), "1 line");
});

test("a read with offset or limit shows the range and the total line count", async () => {
  const window = { path: "flat.txt", offset: 100, limit: 3 };
  assert.equal(meta(window, await readResult(window)), "lines 100–102 of 3400");

  const firstPage = { path: "flat.txt", limit: 3 };
  assert.equal(meta(firstPage, await readResult(firstPage)), "lines 1–3 of 3400");

  const lastPage = { path: "flat.txt", offset: 3398, limit: 10 };
  assert.equal(meta(lastPage, await readResult(lastPage)), "lines 3398–3400 of 3400");
});

test("a read that Pi truncated shows how many of the total lines came back", async () => {
  const args = { path: "flat.txt" };
  const result = await readResult(args);
  assert.equal(result.details?.truncation?.truncated, true);
  assert.equal(result.details?.truncation?.outputLines, 2000);
  assert.equal(meta(args, result), "truncated · 2000 of 3400 lines");
});

test("a result without text has no meta", () => {
  const image: AgentToolResult<ReadToolDetails | undefined> = {
    content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
    details: undefined,
  };
  assert.equal(readMeta({ path: "dot.png" }, image), "");

  const empty: AgentToolResult<ReadToolDetails | undefined> = { content: [], details: undefined };
  assert.equal(readMeta({ path: "dot.png" }, empty), "");
});

test("a whole file read is not confused by a bracketed link after a blank line", async () => {
  writeFileSync(join(dir, "note.md"), "intro\n\n[docs](https://example.com)\nmore\n");
  const args = { path: "note.md" };
  assert.equal(meta(args, await readResult(args)), "4 lines");
});

test("only a SKILL.md read is labelled as a skill, by its directory name", () => {
  assert.equal(skillLabel("/repo/.agents/skills/use-tinyfish/SKILL.md", "/repo"), "use-tinyfish");
  assert.equal(skillLabel(".agents/skills/use-tinyfish/SKILL.md", "/repo"), "use-tinyfish");
  assert.equal(skillLabel("README.md", "/repo"), undefined);
  assert.equal(skillLabel("/repo/docs/SKILL.md.md", "/repo"), undefined);
  assert.equal(skillLabel("/repo/SKILL.md", "/repo"), "repo");
});
