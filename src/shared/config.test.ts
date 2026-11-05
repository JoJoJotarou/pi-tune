import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readJsonObject } from "./config.ts";

function withFile(body: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-config-"));
  try {
    body(join(dir, "pi-tune.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a missing file reads as ok without a value", () => {
  withFile((path) => assert.deepEqual(readJsonObject(path), { ok: true }));
});

test("a JSON object reads as its value", () => {
  withFile((path) => {
    writeFileSync(path, '{"btw":{"allow":["read"]}}');
    assert.deepEqual(readJsonObject(path), { ok: true, value: { btw: { allow: ["read"] } } });
  });
});

test("broken JSON, a non-object and an unreadable path each name the problem", () => {
  withFile((path) => {
    writeFileSync(path, "{");
    assert.match(problemOf(readJsonObject(path)), /^is not valid JSON \(.+\)$/);
    writeFileSync(path, "[]");
    assert.equal(problemOf(readJsonObject(path)), "must contain a JSON object");
    rmSync(path);
    mkdirSync(path);
    assert.match(problemOf(readJsonObject(path)), /^could not be read \(EISDIR/);
  });
});

function problemOf(read: ReturnType<typeof readJsonObject>): string {
  return read.ok ? "" : read.problem;
}
