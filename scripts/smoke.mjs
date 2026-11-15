import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

/** Run Pi over RPC with `extensions` as its only extensions, and answer its `get_commands`. */
function load(extensions) {
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
      ...extensions.flatMap((path) => ["-e", path]),
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
  const commands = parseJsonLines(output).find((row) => row?.type === "response" && row.command === "get_commands");
  return { status: result.status, output, commands };
}

const failures = [];

/** Load `extensions` and record every reason the load is not clean; returns the command names it answered. */
function checkLoad(label, extensions) {
  const { status, output, commands } = load(extensions);
  if (commands?.success !== true) failures.push(`${label}: no get_commands answer (${output.slice(-2000)})`);
  if (/Failed to load extension|Error loading extension/i.test(output)) {
    failures.push(`${label}: extension load error (${output.slice(-2000)})`);
  }
  if (status !== 0) failures.push(`${label}: host exited ${status}`);
  return (commands?.data?.commands ?? []).map((row) => row.name);
}

try {
  const names = checkLoad("package", ["."]);
  for (const name of ["btw", "suggest", "timeline"]) {
    if (!names.includes(name)) failures.push(`package: command /${name} missing (saw ${JSON.stringify(names)})`);
  }
  if (failures.length === 0) console.log("smoke ok: package loaded, commands /btw, /suggest, /timeline");

  for (const file of readdirSync(join(root, "extensions")).filter((name) => name.endsWith(".ts"))) {
    const before = failures.length;
    checkLoad(`${file} alone`, [join("extensions", file)]);
    if (failures.length === before) console.log(`smoke ok: ${file} loaded alone`);
  }
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
