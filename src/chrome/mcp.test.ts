import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  configuredServers,
  connectedServers,
  isMcpConfig,
  mergeServers,
  readMcpFile,
  serverNameFromTool,
} from "./mcp.ts";

test("tool names yield the server between the first mcp__ and the next __", () => {
  assert.equal(serverNameFromTool("mcp__filesystem__read_file"), "filesystem");
  assert.equal(serverNameFromTool("mcp__my_server__a__b"), "my_server");
  assert.equal(serverNameFromTool("mcp__docs-api__search"), "docs_api");
  assert.equal(serverNameFromTool("read"), undefined);
  assert.equal(serverNameFromTool("mcp__"), undefined);
  assert.equal(serverNameFromTool("mcp____tool"), undefined);
});

test("connected servers are distinct and merge - with _", () => {
  assert.deepEqual(connectedServers(["mcp__docs__read", "mcp__docs__search", "mcp__docs-api__x", "bash"]), [
    "docs",
    "docs_api",
  ]);
  assert.deepEqual(connectedServers(["mcp__docs_api__x", "mcp__docs-api__y"]), ["docs_api"]);
  assert.deepEqual(connectedServers([]), []);
});

test("a project entry replaces a user entry and only enabled overrides without a transport", () => {
  const merged = mergeServers(
    {
      mcpServers: {
        docs: { command: "docs-mcp", args: ["--flag"], enabled: true },
        other: { url: "https://example.com/mcp" },
      },
    },
    {
      mcpServers: {
        docs: { enabled: false },
        other: { command: "other-mcp" },
        extra: { command: "extra-mcp" },
      },
    },
  );
  assert.deepEqual(merged.get("docs"), { command: "docs-mcp", args: ["--flag"], enabled: false });
  assert.deepEqual(merged.get("other"), { command: "other-mcp" });
  assert.deepEqual(merged.get("extra"), { command: "extra-mcp" });
});

test("configured servers drop disabled entries and merge - with _", () => {
  assert.deepEqual(
    configuredServers({
      user: {
        mcpServers: {
          docs: { command: "docs-mcp" },
          off: { command: "off-mcp", enabled: false },
          "docs-api": { url: "https://example.com/mcp" },
        },
      },
      project: {
        mcpServers: {
          docs_api: { url: "https://example.com/project" },
          off: { enabled: true },
        },
      },
    }),
    ["docs", "off", "docs_api"],
  );
});

test("a missing project config counts only the user servers", () => {
  assert.deepEqual(configuredServers({ user: { mcpServers: { docs: { command: "docs-mcp" } } } }), ["docs"]);
  assert.deepEqual(configuredServers({}), []);
});

test("extension registered servers count once, unless the config already has the name", () => {
  assert.deepEqual(
    configuredServers({ user: { mcpServers: { "docs-api": { command: "docs-mcp" } } } }, ["docs_api", "jira", "jira"]),
    ["docs_api", "jira"],
  );
});

test("invalid config documents count nothing", () => {
  for (const value of [undefined, null, [], "x", 3, { mcpServers: [] }, { mcpServers: "x" }]) {
    assert.equal(isMcpConfig(value), false);
    assert.deepEqual(configuredServers({ user: value, project: value }), []);
  }
  assert.equal(isMcpConfig({}), true);
  assert.equal(isMcpConfig({ mcpServers: { docs: { command: "x" } } }), true);
});

test("an unusable mcp.json warns once and counts as absent; a missing one is silent", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-tune-mcp-"));
  try {
    const path = join(dir, "mcp.json");
    const warnings: string[] = [];
    const notify = (message: string) => warnings.push(message);

    assert.equal(readMcpFile(path, notify), undefined);
    assert.deepEqual(warnings, []);

    writeFileSync(path, '{"mcpServers":[]}');
    assert.equal(readMcpFile(path, notify), undefined);
    writeFileSync(path, "{");
    assert.equal(readMcpFile(path, notify), undefined);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /mcp\.json has an "mcpServers" value that is not an object$/);
    assert.match(warnings[1], /mcp\.json is not valid JSON/);

    writeFileSync(path, '{"mcpServers":{"docs":{"command":"x"}}}');
    assert.deepEqual(readMcpFile(path, notify), { mcpServers: { docs: { command: "x" } } });
    assert.equal(warnings.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
