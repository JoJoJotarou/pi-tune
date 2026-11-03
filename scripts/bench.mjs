// Wheel latency in a long session: Pi alone vs Pi with pi-tune.
//
//   npm run bench                       # builds a long session with the scripted model first
//   npm run bench -- <session.jsonl>    # or scrolls an existing session (copied, never modified)
//
// Each sample is the time from a wheel event to the first byte of the frame Pi draws for it.
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import xterm from "@xterm/headless";
import { spawn } from "node-pty";

const ROUNDS = 30;
const WHEELS = 80;
const COLS = 120;
const ROWS = 40;

const root = resolve(import.meta.dirname, "..");
const sdkDir = join(root, "node_modules/@earendil-works/pi-coding-agent");
const cli = join(sdkDir, JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")).bin.pi);
const fauxExtension = join(root, "test/e2e/faux-provider.ts");
const HOST_TERMINAL_ENV = /^(TERM_PROGRAM|KITTY_|GHOSTTY_|ITERM_|WEZTERM_|LC_TERMINAL|TMUX)/;

// node-pty 1.1.0 ships the prebuild spawn-helper without the execute bit, so posix_spawnp fails.
const helper = join(root, "node_modules/node-pty/prebuilds", `${process.platform}-${process.arch}`, "spawn-helper");
if (existsSync(helper) && (statSync(helper).mode & 0o111) === 0) chmodSync(helper, 0o755);

const work = mkdtempSync(join(tmpdir(), "pi-tune-bench-"));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function startPi({ tune, sessionArgs, scenario }) {
  const agentDir = join(work, `agent-${Date.now()}`);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({
      theme: "dark",
      tuiMode: "fullscreen",
      fullscreenScrollbar: "always",
      quietStartup: "header",
      hideThinkingBlock: false,
    }),
  );
  const scenarioPath = join(agentDir, "scenario.json");
  writeFileSync(scenarioPath, JSON.stringify(scenario ?? { turns: [] }));
  const args = [
    cli,
    "--offline",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-mcp",
    "-e",
    fauxExtension,
    ...(tune ? ["-e", root] : []),
    "--provider",
    "faux",
    "--model",
    "scripted",
    ...sessionArgs,
  ];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !HOST_TERMINAL_ENV.test(key)));
  const pty = spawn(process.execPath, args, {
    name: "xterm-256color",
    cols: COLS,
    rows: ROWS,
    cwd: join(work, "project"),
    env: {
      ...env,
      TERM_PROGRAM: "vscode",
      COLORTERM: "truecolor",
      PI_CODING_AGENT_DIR: agentDir,
      PI_TUNE_SCENARIO: scenarioPath,
    },
  });
  const term = new xterm.Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
  const pi = { pty, term, lastData: 0, firstData: 0, exited: false };
  pty.onData((data) => {
    const now = performance.now();
    pi.lastData = now;
    if (pi.firstData === 0) pi.firstData = now;
    term.write(data);
  });
  pty.onExit(() => {
    pi.exited = true;
  });
  return pi;
}

function screen(pi) {
  const buffer = pi.term.buffer.active;
  return Array.from(
    { length: ROWS },
    (_, y) => buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? "",
  ).join("\n");
}

async function waitFor(pi, text, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (!screen(pi).includes(text)) {
    if (pi.exited) throw new Error(`Pi exited while waiting for ${JSON.stringify(text)}`);
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${JSON.stringify(text)}:\n${screen(pi)}`);
    await sleep(50);
  }
}

/** The footer names the model before startup finishes; input typed earlier is not submitted. */
async function waitReady(pi) {
  await waitFor(pi, "scripted");
  const deadline = Date.now() + 30_000;
  while (screen(pi).includes("Startup is still in progress")) {
    if (Date.now() > deadline) throw new Error(`startup never finished:\n${screen(pi)}`);
    await sleep(50);
  }
  await waitQuiet(pi, 500);
}

async function waitQuiet(pi, ms, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (performance.now() - pi.lastData < ms) {
    if (Date.now() > deadline) throw new Error(`Pi never went quiet:\n${screen(pi)}`);
    await sleep(5);
  }
}

async function quit(pi) {
  pi.pty.write("/quit\r");
  for (let i = 0; i < 50 && !pi.exited; i++) await sleep(100);
  if (!pi.exited) pi.pty.kill();
  pi.term.dispose();
}

function sourceFile(index) {
  const lines = [`export const name${index} = "file ${index}";`, ""];
  for (let line = 0; line < 60; line++) {
    lines.push(
      `export function value${index}_${line}(input: number): number {`,
      `  return input * ${line} + ${index};`,
      "}",
    );
  }
  return `${lines.join("\n")}\n`;
}

/** Each round: thinking, an edit with a diff, bash output, a read, an ls and a Markdown answer. */
function longScenario() {
  const thinking = Array.from(
    { length: 12 },
    (_, i) => `Step ${i}: check \`value_${i}\` and **weigh** it against the plan before editing.`,
  ).join(" ");
  const answer = (round) =>
    [
      `## Round ${round}`,
      "",
      ...Array.from({ length: 8 }, (_, i) => `- item ${i}: \`value${round}_${i}\` now adds the file index`),
      "",
      "```ts",
      `export function value${round}_1(input: number): number {`,
      `  return input * 2 + ${round};`,
      "}",
      "```",
      "",
      `Round ${round} done.`,
    ].join("\n");
  const turns = [];
  for (let round = 0; round < ROUNDS; round++) {
    const path = `src/f${round}.ts`;
    turns.push(
      [
        { thinking },
        {
          tool: "edit",
          args: {
            path,
            edits: [{ oldText: `  return input * 1 + ${round};`, newText: `  return input * 2 + ${round};` }],
          },
        },
      ],
      [{ tool: "bash", args: { command: "seq 1 40" } }],
      [{ tool: "read", args: { path } }],
      [{ tool: "ls", args: { path: "src" } }],
      [{ thinking }, { text: answer(round) }],
    );
  }
  return { tokensPerSecond: 100_000, turns };
}

function newestSession(dir) {
  const files = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".jsonl")) files.push(path);
    }
  };
  walk(dir);
  if (files.length === 0) throw new Error(`no session file was written under ${dir}`);
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

async function buildSession() {
  const projectDir = join(work, "project");
  for (let round = 0; round < ROUNDS; round++) {
    mkdirSync(join(projectDir, "src"), { recursive: true });
    writeFileSync(join(projectDir, `src/f${round}.ts`), sourceFile(round));
  }
  const sessionDir = join(work, "sessions");
  const pi = startPi({ tune: false, sessionArgs: ["--session-dir", sessionDir], scenario: longScenario() });
  try {
    await waitReady(pi);
    for (let round = 0; round < ROUNDS; round++) {
      pi.pty.write(`round ${round}\r`);
      await waitFor(pi, `Round ${round} done.`);
    }
  } finally {
    await quit(pi);
  }
  return newestSession(sessionDir);
}

/** A copy whose header names the bench project, so Pi does not ask to trust the session's own folder. */
function copySession(source) {
  const lines = readFileSync(source, "utf8").split("\n");
  const header = JSON.parse(lines[0]);
  header.cwd = join(work, "project");
  lines[0] = JSON.stringify(header);
  const copy = join(work, `session-${Date.now()}.jsonl`);
  writeFileSync(copy, lines.join("\n"));
  return copy;
}

async function measure(session, tune) {
  const pi = startPi({ tune, sessionArgs: ["--session", copySession(session)] });
  try {
    await waitReady(pi);
    const samples = [];
    for (let i = 0; i < WHEELS; i++) {
      pi.firstData = 0;
      const sent = performance.now();
      pi.pty.write(`\x1b[<64;${Math.floor(COLS / 2)};${Math.floor(ROWS / 3)}M`);
      while (pi.firstData === 0) {
        if (performance.now() - sent > 5000) throw new Error(`no frame within 5 s of wheel event ${i}`);
        await sleep(1);
      }
      samples.push(pi.firstData - sent);
      await waitQuiet(pi, 40);
    }
    return samples.sort((a, b) => a - b);
  } finally {
    await quit(pi);
  }
}

const at = (samples, p) => `${samples[Math.min(samples.length - 1, Math.floor(samples.length * p))].toFixed(1)} ms`;

try {
  mkdirSync(join(work, "project"), { recursive: true });
  const given = process.argv[2];
  const session = given ? resolve(given) : await buildSession();
  const pi = await measure(session, false);
  const tuned = await measure(session, true);
  console.log(`session: ${given ?? `${ROUNDS} scripted rounds`} (${(statSync(session).size / 1e6).toFixed(1)} MB)`);
  console.log(`${"".padEnd(12)}${"p50".padStart(10)}${"p90".padStart(10)}${"max".padStart(10)}`);
  for (const [label, samples] of [
    ["pi", pi],
    ["pi + tune", tuned],
  ]) {
    console.log(
      `${label.padEnd(12)}${at(samples, 0.5).padStart(10)}${at(samples, 0.9).padStart(10)}${at(samples, 1).padStart(10)}`,
    );
  }
} catch (error) {
  console.error(`bench failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
