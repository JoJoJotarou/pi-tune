import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFindTool, createGrepTool, createLsTool } from "@earendil-works/pi-coding-agent";
import { findMeta, grepMeta, lsMeta } from "./search.ts";

const dir = mkdtempSync(join(tmpdir(), "pi-tune-search-meta-"));
writeFileSync(join(dir, "alpha.txt"), "alpha\nbeta\n");
writeFileSync(join(dir, "alpha.ts"), "alpha\n");
mkdirSync(join(dir, "nested"));
writeFileSync(join(dir, "nested", "beta.ts"), "alpha\nalpha\n");
mkdirSync(join(dir, "empty"));
mkdirSync(join(dir, "parents"));
mkdirSync(join(dir, "parents", "child"));
mkdirSync(join(dir, "limited"));
writeFileSync(join(dir, "limited", "first.txt"), "x\n");
writeFileSync(join(dir, "limited", "second.txt"), "y\n");

const grep = createGrepTool(dir);
const find = createFindTool(dir);
const ls = createLsTool(dir);

test("grep counts matches and files", async () => {
  assert.equal(grepMeta(await grep.execute("grep-meta-test", { pattern: "alpha" })), "4 matches · 3 files");
  assert.equal(grepMeta(await grep.execute("grep-meta-test", { pattern: "beta" })), "1 match · 1 file");
  assert.equal(
    grepMeta(await grep.execute("grep-meta-test", { pattern: "alpha", path: "nested/beta.ts" })),
    "2 matches · 1 file",
  );
});

test("grep reports no matches", async () => {
  assert.equal(grepMeta(await grep.execute("grep-meta-test", { pattern: "nothing" })), "no matches");
});

test("grep appends the limit note and does not count context lines", async () => {
  const limited = await grep.execute("grep-meta-test", { pattern: "alpha", path: "nested/beta.ts", limit: 2 });
  assert.equal(limited.details?.matchLimitReached, 2);
  assert.equal(grepMeta(limited), "2 matches · 1 file · limit reached");

  const withContext = await grep.execute("grep-meta-test", { pattern: "beta", path: "alpha.txt", context: 1 });
  assert.equal(grepMeta(withContext), "1 match · 1 file");
});

test("find counts matched entries", async () => {
  assert.equal(findMeta(await find.execute("find-meta-test", { pattern: "*.ts" })), "2 files");
  assert.equal(findMeta(await find.execute("find-meta-test", { pattern: "alpha.txt" })), "1 file");
  assert.equal(findMeta(await find.execute("find-meta-test", { pattern: "*.zzz" })), "no files");
});

test("find appends the limit note", async () => {
  const limited = await find.execute("find-meta-test", { pattern: "*.ts", limit: 1 });
  assert.equal(limited.details?.resultLimitReached, 1);
  assert.equal(findMeta(limited), "1 file · limit reached");
});

test("ls counts dirs and files and omits a zero part", async () => {
  assert.equal(lsMeta(await ls.execute("ls-meta-test", {})), "4 dirs · 2 files");
  assert.equal(lsMeta(await ls.execute("ls-meta-test", { path: "nested" })), "1 file");
  assert.equal(lsMeta(await ls.execute("ls-meta-test", { path: "parents" })), "1 dir");
});

test("ls reports an empty directory", async () => {
  assert.equal(lsMeta(await ls.execute("ls-meta-test", { path: "empty" })), "empty");
});

test("ls appends the limit note", async () => {
  const limited = await ls.execute("ls-meta-test", { path: "limited", limit: 1 });
  assert.equal(limited.details?.entryLimitReached, 1);
  assert.equal(lsMeta(limited), "1 file · limit reached");
});
