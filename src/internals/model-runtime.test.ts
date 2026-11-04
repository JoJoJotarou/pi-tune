import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { modelRuntimeOf } from "./model-runtime.ts";

test("returns the ModelRuntime behind a ModelRegistry", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-runtime-"));
  try {
    const runtime = await ModelRuntime.create({
      modelsPath: null,
      authPath: join(dir, "auth.json"),
      refreshOnCreate: false,
    });
    assert.equal(modelRuntimeOf(new ModelRegistry(runtime)), runtime);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("returns an Error when the registry has no ModelRuntime", () => {
  for (const registry of [{}, { runtime: {} }]) {
    const result = modelRuntimeOf(registry as unknown as ModelRegistry);
    assert.ok(result instanceof Error);
    assert.match(result.message, /model picker is unavailable/);
  }
});
