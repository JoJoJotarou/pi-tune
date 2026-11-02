import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import xterm from "@xterm/headless";
import { spawn } from "node-pty";
import { renderPng } from "./screenshot.ts";

export type Block = { thinking: string } | { text: string } | { tool: string; args: Record<string, unknown> };

export interface Scenario {
  files?: Record<string, string>;
  turns: Block[][];
  tokensPerSecond?: number;
}

export interface StartOptions {
  scenario: Scenario;
  cols?: number;
  rows?: number;
  tune?: boolean;
  settings?: Record<string, unknown>;
}

export interface PiSession {
  readonly projectDir: string;
  type(text: string): void;
  press(key: string): void;
  paste(text: string): void;
  click(col: number, row: number, count?: number): void;
  clickText(text: string, nth?: number): void;
  waitFor(text: string | RegExp, timeoutMs?: number): Promise<void>;
  waitForGone(text: string | RegExp, timeoutMs?: number): Promise<void>;
  screen(): string[];
  shot(name: string): Promise<void>;
  close(): Promise<void>;
}

const repoRoot = resolve(import.meta.dirname, "../..");
const sdkDir = join(repoRoot, "node_modules/@earendil-works/pi-coding-agent");
const piCli = join(sdkDir, JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8")).bin.pi);
const fauxExtension = join(import.meta.dirname, "faux-provider.ts");
const HOST_TERMINAL_ENV = /^(TERM_PROGRAM|KITTY_|GHOSTTY_|ITERM_|WEZTERM_|LC_TERMINAL|TMUX)/;

const KEYS: Record<string, string> = {
  enter: "\r",
  escape: "\x1b",
  tab: "\t",
  "shift+tab": "\x1b[Z",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  home: "\x1b[H",
  end: "\x1b[F",
  backspace: "\x7f",
};

function keySequence(key: string): string {
  const lower = key.toLowerCase();
  const named = KEYS[lower];
  if (named) return named;
  const ctrl = /^ctrl\+([a-z])$/.exec(lower);
  if (ctrl) return String.fromCharCode(ctrl[1].charCodeAt(0) - 96);
  throw new Error(`Unknown key: ${key}`);
}

// node-pty 1.1.0 ships the prebuild spawn-helper without the execute bit, so posix_spawnp fails.
function ensureSpawnHelper(): void {
  const helper = join(
    repoRoot,
    "node_modules/node-pty/prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );
  if (!existsSync(helper)) return;
  if ((statSync(helper).mode & 0o111) === 0) chmodSync(helper, 0o755);
}

function findTool(names: string[]): string | undefined {
  const dirs = [...(process.env.PATH ?? "").split(delimiter).filter(Boolean), join(homedir(), ".pi/agent/bin")];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function linkTools(binDir: string): void {
  for (const [name, candidates] of [
    ["fd", ["fd", "fdfind"]],
    ["rg", ["rg"]],
  ] as const) {
    const tool = findTool([...candidates]);
    if (tool) symlinkSync(tool, join(binDir, name));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

function matches(text: string, matcher: string | RegExp): boolean {
  if (typeof matcher === "string") return text.includes(matcher);
  matcher.lastIndex = 0;
  return matcher.test(text);
}

export async function startPi(options: StartOptions): Promise<PiSession> {
  const cols = options.cols ?? 100;
  const rows = options.rows ?? 40;
  ensureSpawnHelper();

  const root = mkdtempSync(join(tmpdir(), "pi-tune-e2e-"));
  const agentDir = join(root, "agent");
  const projectDir = join(root, "project");
  const binDir = join(agentDir, "bin");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(projectDir, { recursive: true });

  for (const [path, content] of Object.entries(options.scenario.files ?? {})) {
    const target = join(projectDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  linkTools(binDir);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark", ...options.settings }, null, 2));
  const scenarioPath = join(root, "scenario.json");
  writeFileSync(scenarioPath, JSON.stringify(options.scenario));

  const args = [
    piCli,
    "--offline",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-prompt-templates",
    "--no-mcp",
    "-e",
    fauxExtension,
  ];
  if (options.tune ?? true) args.push("-e", repoRoot);
  args.push("--provider", "faux", "--model", "scripted");

  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && !HOST_TERMINAL_ENV.test(entry[0]),
    ),
  );
  const pty = spawn(process.execPath, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd: projectDir,
    env: {
      ...env,
      // Pi detects terminal features (OSC 8 links, image protocols) from these; @xterm/headless is the emulator
      // behind VS Code's terminal, so name that instead of whatever terminal runs the tests.
      TERM_PROGRAM: "vscode",
      COLORTERM: "truecolor",
      PI_CODING_AGENT_DIR: agentDir,
      PI_TUNE_SCENARIO: scenarioPath,
    },
  });
  const term = new xterm.Terminal({ cols, rows, allowProposedApi: true });

  let queue: Promise<void> = Promise.resolve();
  pty.onData((data) => {
    queue = queue.then(() => new Promise<void>((done) => term.write(data, done)));
  });

  async function settledScreen(): Promise<string[]> {
    await queue;
    return readScreen();
  }

  function readScreen(): string[] {
    const buffer = term.buffer.active;
    return Array.from({ length: rows }, (_, y) => buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? "");
  }

  async function waitFor(text: string | RegExp, timeoutMs = 20_000, gone = false): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const current = await settledScreen();
      if (matches(current.join("\n"), text) !== gone) return;
      if (Date.now() >= deadline) {
        throw new Error(
          `${gone ? "waitForGone" : "waitFor"} timed out after ${timeoutMs}ms: ${String(text)}\n--- screen ---\n${current.join("\n")}`,
        );
      }
      await sleep(50);
    }
  }

  function columnOf(lineIndex: number, offset: number): number {
    const line = term.buffer.active.getLine(term.buffer.active.viewportY + lineIndex);
    if (!line) return offset;
    let chars = "";
    for (let x = 0; x < line.length; x++) {
      if (chars.length >= offset) return x;
      chars += line.getCell(x)?.getChars() ?? "";
    }
    return offset;
  }

  const session: PiSession = {
    projectDir,
    type(text) {
      pty.write(text);
    },
    press(key) {
      pty.write(keySequence(key));
    },
    paste(text) {
      pty.write(`\x1b[200~${text}\x1b[201~`);
    },
    click(col, row, count = 1) {
      for (let i = 0; i < count; i++) {
        pty.write(`\x1b[<0;${col + 1};${row + 1}M`);
        pty.write(`\x1b[<0;${col + 1};${row + 1}m`);
      }
    },
    clickText(text, nth = 1) {
      let seen = 0;
      const current = term.buffer.active;
      for (let y = 0; y < rows; y++) {
        const row = current.getLine(current.viewportY + y)?.translateToString(true) ?? "";
        let from = 0;
        for (;;) {
          const offset = row.indexOf(text, from);
          if (offset < 0) break;
          seen++;
          if (seen === nth) {
            const col = columnOf(y, offset);
            session.click(col, y);
            return;
          }
          from = offset + 1;
        }
      }
      throw new Error(`clickText: no match #${nth} for ${JSON.stringify(text)}`);
    },
    waitFor(text, timeoutMs) {
      return waitFor(text, timeoutMs, false);
    },
    waitForGone(text, timeoutMs) {
      return waitFor(text, timeoutMs, true);
    },
    screen: readScreen,
    async shot(name) {
      const dir = process.env.PI_TUNE_SHOTS;
      if (!dir) return;
      await queue;
      mkdirSync(dir, { recursive: true });
      renderPng(term, join(dir, `${name}.png`), options.settings?.theme === "light" ? "light" : "dark");
    },
    async close() {
      try {
        pty.kill();
      } finally {
        term.dispose();
        rmSync(root, { recursive: true, force: true });
      }
    },
  };

  try {
    // The footer names the model once Pi is ready; it omits "(faux)" when faux is the only provider.
    await waitFor("scripted", 30_000);
    await sleep(1500);
  } catch (error) {
    await session.close();
    throw error;
  }
  return session;
}
