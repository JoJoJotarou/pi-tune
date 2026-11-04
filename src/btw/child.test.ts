import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createBashToolDefinition, createReadToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type SideToolOptions, sideTool } from "./child.ts";
import { DEFAULT_RULES } from "./rules.ts";
import { detectSandbox } from "./sandbox.ts";

type ToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number];

function info(definition: { name: string; description: string; parameters: unknown; promptGuidelines?: unknown }) {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    ...(definition.promptGuidelines ? { promptGuidelines: definition.promptGuidelines } : {}),
  } as ToolInfo;
}

function options(overrides: Partial<SideToolOptions> = {}) {
  const denied: string[] = [];
  const unsandboxed: string[] = [];
  const value: SideToolOptions = {
    rules: DEFAULT_RULES,
    rulesPath: "/agent/pi-tune.json",
    sandbox: () => new Error("no sandbox in this test"),
    onDenied: (label) => denied.push(label),
    onUnsandboxed: (problem) => unsandboxed.push(problem.message),
    ...overrides,
  };
  return { value, denied, unsandboxed };
}

async function run(tool: ReturnType<typeof sideTool>, params: unknown) {
  return tool.execute("call-1", params as never, undefined, undefined, undefined as never);
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((block) => block.text ?? "").join("");
}

describe("sideTool", () => {
  const dir = mkdtempSync(join(process.env.HOME ?? tmpdir(), ".pi-tune-side-tools-"));
  writeFileSync(join(dir, "notes.md"), "hello from notes\n");
  const read = info(createReadToolDefinition(dir));
  const bash = info(createBashToolDefinition(dir));

  it("declares exactly what the parent declares", () => {
    for (const parent of [read, bash]) {
      const tool = sideTool(parent, dir, options().value);
      assert.equal(tool.name, parent.name);
      assert.equal(tool.description, parent.description);
      assert.equal(JSON.stringify(tool.parameters), JSON.stringify(parent.parameters));
      assert.deepEqual(tool.promptGuidelines, parent.promptGuidelines);
    }
  });

  it("runs an allowed built-in tool for real", async () => {
    const result = await run(sideTool(read, dir, options().value), { path: "notes.md" });
    assert.match(text(result), /hello from notes/);
  });

  it("refuses a call the rules do not allow, naming the rule file", async () => {
    const { value, denied } = options();
    await assert.rejects(
      run(sideTool(bash, dir, value), { command: "echo hi" }),
      /bash\(echo hi\) is not in "btw\.allow" for btw threads\. The user can allow it in "btw\.allow" of \/agent\/pi-tune\.json/,
    );
    assert.deepEqual(denied, ["bash(echo hi)"]);
  });

  it("refuses an extension tool even when allowed, because only the main session can run it", async () => {
    const { value, denied } = options({ rules: { allow: ["mcp__*"], deny: [] } });
    const mcp = info({ name: "mcp__docs__search", description: "search", parameters: { type: "object" } });
    await assert.rejects(run(sideTool(mcp, dir, value), {}), /runs only in the main session/);
    assert.deepEqual(denied, ["mcp__docs__search (main session only)"]);
  });

  it("runs an allowed bash command unsandboxed when there is no sandbox, and says so", async () => {
    const { value, unsandboxed } = options({ rules: { allow: ["bash(echo *)"], deny: [] } });
    const result = await run(sideTool(bash, dir, value), { command: "echo plain" });
    assert.match(text(result), /plain/);
    assert.deepEqual(unsandboxed, ["no sandbox in this test"]);
  });

  const kind = detectSandbox();
  it("runs an allowed bash command read-only in this machine's sandbox", {
    skip: kind instanceof Error ? `no sandbox here: ${kind.message}` : false,
  }, async () => {
    const { value } = options({ rules: { allow: ["bash(touch *)"], deny: [] }, sandbox: () => kind });
    const result = await run(sideTool(bash, dir, value), { command: "touch made.txt" }).then(
      (done) => text(done),
      (error: unknown) => String(error),
    );
    assert.match(result, /Operation not permitted|Read-only file system/);
    assert.ok(!existsSync(join(dir, "made.txt")), "the sandbox blocked the write");
  });

  it("cleans up", () => {
    rmSync(dir, { recursive: true, force: true });
  });
});
