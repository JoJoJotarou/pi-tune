import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { detectSandbox, sandboxCommand } from "./sandbox.ts";

function run(command: string, cwd: string) {
  return spawnSync("/bin/sh", ["-c", command], { cwd, encoding: "utf8", timeout: 10_000 });
}

describe("sandboxCommand", () => {
  it("passes the command through one quoted argument", () => {
    const command = sandboxCommand("bwrap", `echo 'it''s' "$HOME"`);
    assert.ok(command.startsWith("bwrap --ro-bind / / "), command);
    assert.ok(command.endsWith(`/bin/bash -c 'echo '\\''it'\\'''\\''s'\\'' "$HOME"'`), command);
  });

  it("refuses an unknown platform", () => {
    const result = detectSandbox("win32");
    assert.ok(result instanceof Error);
    assert.match(result.message, /no read-only sandbox for win32/);
  });

  const kind = detectSandbox();
  it("blocks writes and keeps reads on this machine", {
    skip: kind instanceof Error ? `no sandbox here: ${kind.message}` : false,
  }, () => {
    if (kind instanceof Error) return;
    const dir = mkdtempSync(join(process.env.HOME ?? tmpdir(), ".pi-tune-sandbox-"));
    try {
      const write = run(sandboxCommand(kind, "echo x > written.txt"), dir);
      assert.notEqual(write.status, 0, "the write fails");
      assert.ok(!existsSync(join(dir, "written.txt")));
      const read = run(sandboxCommand(kind, "pwd; echo ok"), dir);
      assert.equal(read.status, 0, read.stderr);
      assert.match(read.stdout, /ok/);
      assert.ok(read.stdout.includes(dir.split("/").at(-1) ?? "?"), "the command runs in the caller's directory");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
