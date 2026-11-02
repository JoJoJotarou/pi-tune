import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sdkDir = join(root, "node_modules/@earendil-works/pi-coding-agent");
const cli = join(sdkDir, JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")).bin.pi);
const agentDir = mkdtempSync(join(tmpdir(), "pi-tune-smoke-"));

const input = `${JSON.stringify({ type: "get_commands" })}\n`;

function parseJsonLines(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

try {
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "--offline",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-context-files",
      "--no-prompt-templates",
      "--no-mcp",
      "-e",
      ".",
      "--mode",
      "rpc",
    ],
    {
      cwd: root,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      input,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    },
  );

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const responses = parseJsonLines(output);
  const commands = responses.find((row) => row?.type === "response" && row.command === "get_commands");

  const failures = [];
  const check = (name, ok, evidence) => {
    if (!ok) failures.push(`${name} (observed: ${JSON.stringify(evidence)})`);
  };

  check("host answered get_commands", commands?.success === true, commands ?? null);
  check(
    "no extension load error",
    !/Failed to load extension|Error loading extension/i.test(output),
    output.slice(-2000),
  );
  check("host exited clean", result.status === 0, { status: result.status, error: result.error?.message ?? null });

  if (failures.length > 0) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("smoke ok: package loaded without extension errors");
  }
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}
