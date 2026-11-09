import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessageEvent, Usage } from "@earendil-works/pi-ai";
import {
  initTheme,
  type MessageEndEvent,
  type MessageUpdateEvent,
  type ReadonlyFooterDataProvider,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, type TUI } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import type { GitState } from "./git.ts";
import { type ChromeContext, type ChromeHost, type ChromeSession, createChromeSession } from "./session.ts";

const theme = testTheme("dark");
initTheme("dark");

function usage(output: number): Usage {
  const cost = { input: 0, output, cacheRead: 0, cacheWrite: 0, total: 0.25 };
  return { input: 100, output, cacheRead: 0, cacheWrite: 0, totalTokens: 100 + output, cost };
}

/** The assistant message fields the session reads; the full `AgentMessage` carries more than the test needs. */
function streamUpdate(type: AssistantMessageEvent["type"], output: number): MessageUpdateEvent {
  return {
    type: "message_update",
    message: { role: "assistant", usage: usage(output) },
    assistantMessageEvent: { type },
  } as MessageUpdateEvent;
}

function streamEnd(output: number): MessageEndEvent {
  return { type: "message_end", message: { role: "assistant", usage: usage(output) } } as MessageEndEvent;
}

interface Harness {
  session: ChromeSession;
  notified: string[];
  /** Appends an entry and moves the leaf onto it, as Pi's session manager does. */
  append(entry: SessionEntry): void;
  /** Swaps in another session's entries, keeping the leaf id. */
  replaceEntries(entries: SessionEntry[]): void;
  /** How often the session read the whole entry list. */
  entryReads(): number;
  setEditorText(text: string): void;
  setFocus(focus: boolean | Error): void;
  /** Swaps the repository reading the fake git returns. */
  setGit(state: GitState | undefined): void;
  setGitError(error: Error): void;
  /** How many times the session asked git for the repository state. */
  gitReads(): number;
  /** Lets the pending repository reading settle. */
  flush(): Promise<void>;
  now(ms: number): void;
  restart(): void;
  header(width?: number): string[];
  footer(width?: number): string[];
}

type HeaderFactory = NonNullable<Parameters<ChromeContext["ui"]["setHeader"]>[0]>;
type FooterFactory = NonNullable<Parameters<ChromeContext["ui"]["setFooter"]>[0]>;

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`session.start did not register the ${what}`);
  return value;
}

interface HarnessOptions {
  model?: ChromeContext["model"];
  sessionName?: string;
  settings?: ReturnType<ChromeHost["settings"]>;
}

function harness(options: HarnessOptions = {}): Harness {
  const notified: string[] = [];
  let entries: SessionEntry[] = [];
  let leaf: string | null = null;
  let reads = 0;
  let editorText = "";
  let focus: boolean | Error = true;
  let nowMs = 10_000;
  let gitReads = 0;
  let gitState: GitState | undefined = { ahead: 2, behind: 1, added: 6, deleted: 1 };
  let gitError: Error | undefined;
  let headerFactory: Parameters<ChromeContext["ui"]["setHeader"]>[0];
  let footerFactory: Parameters<ChromeContext["ui"]["setFooter"]>[0];

  const ctx: ChromeContext = {
    cwd: "/tmp/myproj",
    isProjectTrusted: () => false,
    ui: {
      notify: (message) => notified.push(message),
      getEditorText: () => editorText,
      setHeader: (factory) => {
        headerFactory = factory;
      },
      setFooter: (factory) => {
        footerFactory = factory;
      },
    },
    sessionManager: {
      getEntries: () => {
        reads += 1;
        return entries;
      },
      getLeafId: () => leaf,
      getSessionName: () => options.sessionName,
    },
    getContextUsage: () => ({ tokens: 1_000, contextWindow: 200_000, percent: 0.5 }),
    model: options.model,
  };
  const host: ChromeHost = {
    commands: () => [{ source: "skill" }, { source: "skill" }, { source: "builtin" }],
    allTools: () => [{ name: "read" }, { name: "mcp__docs__fetch" }],
    mcpServers: () => [{ name: "docs" }],
    settings: () => options.settings ?? {},
    thinkingLevel: () => "high",
    agentDir: () => "/tmp/pi-tune-session-test-no-such-dir",
    now: () => nowMs,
    gitState: async () => {
      gitReads += 1;
      if (gitError) throw gitError;
      return gitState;
    },
    editorFocused: () => focus,
  };

  const session = createChromeSession(host);
  session.start(ctx);

  const renders = { count: 0 };
  const tui = { requestRender: () => renders.count++ } as unknown as TUI;
  const footerData = {
    getGitBranch: (): string | null => "feat/x",
    getExtensionStatuses: () => new Map<string, string>([["btw", "1 thread"]]),
    getAvailableProviderCount: () => 2,
    onBranchChange: (): (() => void) => () => {},
  } satisfies ReadonlyFooterDataProvider;

  let header: ReturnType<HeaderFactory>;
  let footer: ReturnType<FooterFactory>;
  const mount = (): void => {
    header = required(headerFactory, "header")(tui, theme);
    footer = required(footerFactory, "footer")(tui, theme, footerData);
  };
  mount();
  return {
    session,
    notified,
    append: (entry) => {
      entries.push(entry);
      leaf = `entry-${entries.length}`;
    },
    replaceEntries: (next) => {
      entries = next;
    },
    entryReads: () => reads,
    setEditorText: (text) => {
      editorText = text;
    },
    setFocus: (value) => {
      focus = value;
    },
    setGit: (state) => {
      gitState = state;
    },
    setGitError: (error) => {
      gitError = error;
    },
    gitReads: () => gitReads,
    flush: () => new Promise((resolve) => setImmediate(resolve)),
    now: (ms) => {
      nowMs = ms;
    },
    restart: () => {
      session.start(ctx);
      mount();
    },
    header: (width = 100) => header.render(width),
    footer: (width = 100) => footer.render(width),
  };
}

function plain(lines: readonly string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line));
}

test("start renders the header counts and the footer line", () => {
  const h = harness();
  h.append({ type: "usage", usage: usage(50) } as SessionEntry);

  const header = plain(h.header())[0];
  assert.match(header, /2 skills/);
  assert.match(header, /MCP 1\/1/);
  assert.match(header, /myproj/);

  const footer = plain(h.footer());
  assert.match(footer[0], /myproj · ⎇ feat\/x/);
  assert.match(footer[1], /↑100 ↓50/);
  assert.match(footer[1], /◔ 0\.5% \(1\.0k\/200k\)/);
  assert.match(footer[1], /commands/);
  assert.equal(footer[2], "1 thread");
});

test("the focus check warns once per session, then keeps the hints", () => {
  const h = harness();
  h.setFocus(new Error("this Pi screen does not report focus"));
  h.footer();
  h.footer();
  assert.equal(h.notified.length, 1);
  assert.match(h.notified[0], /^pi-tune chrome: /);
  assert.match(plain(h.footer())[1], /commands/);
});

test("a focused dialog hides the key hints", () => {
  const h = harness();
  assert.match(plain(h.footer())[1], /commands/);

  h.setFocus(false);
  const rows = plain(h.footer());
  assert.doesNotMatch(rows[1], /commands/);
  assert.match(rows[0], /myproj · ⎇ feat\/x/);
  assert.deepEqual(h.notified, []);
});

test("a typed draft during a run shows the steer hints", () => {
  const h = harness();
  h.setEditorText("fix it");
  h.session.agentStart();
  assert.match(plain(h.footer())[1], /steer/);

  h.session.agentSettled();
  const line = plain(h.footer())[1];
  assert.doesNotMatch(line, /steer/);
  assert.match(line, /files/);
});

test("ttft and the rate come from the stream clock", () => {
  const h = harness();
  h.session.turnStart();
  h.now(12_500);
  h.session.messageUpdate(streamUpdate("text_delta", 10));
  h.now(15_000);
  const streaming = plain(h.footer())[1];
  assert.match(streaming, /4 tok\/s/);
  assert.match(streaming, /2\.5s TTFT/);

  h.now(17_000);
  h.session.messageEnd(streamEnd(40));
  assert.match(plain(h.footer())[1], /9 tok\/s/);
});

test("editor stash and btw mode change the hints", () => {
  const h = harness();
  h.session.editorReady();
  h.setEditorText("note");
  assert.match(plain(h.footer())[1], /stash/);

  h.setEditorText("");
  h.session.editorStash(true);
  assert.match(plain(h.footer())[1], /restore/);

  h.session.btwMode(true);
  const line = plain(h.footer())[1];
  assert.doesNotMatch(line, /commands/);
  assert.doesNotMatch(line, /shell/);
  assert.match(line, /files/);
});

test("shutdown clears the session and a restart starts fresh", () => {
  const h = harness();
  h.setEditorText("fix it");
  h.session.agentStart();
  h.session.turnStart();
  h.session.messageUpdate(streamUpdate("text_delta", 10));
  h.session.messageEnd(streamEnd(40));

  h.session.shutdown();
  assert.deepEqual(h.footer(), []);
  assert.deepEqual(h.header(), []);

  h.replaceEntries([]);
  h.setEditorText("");
  h.restart();
  const restarted = plain(h.footer());
  assert.match(restarted[0], /myproj/);
  assert.doesNotMatch(restarted.join("\n"), /tok\/s|TTFT|steer/);
});

test("the footer rereads the entries only after an append", () => {
  const h = harness();
  h.append({ type: "usage", usage: usage(50) } as SessionEntry);
  assert.match(plain(h.footer())[1], /↑100 ↓50/);
  h.footer();
  h.footer();
  assert.equal(h.entryReads(), 1);

  h.append({ type: "usage", usage: usage(30) } as SessionEntry);
  assert.match(plain(h.footer())[1], /↑200 ↓80/);
  assert.equal(h.entryReads(), 2);
});

test("a restarted session does not reuse the previous session's totals", () => {
  const h = harness();
  h.append({ type: "usage", usage: usage(50) } as SessionEntry);
  assert.match(plain(h.footer())[1], /↑100 ↓50/);

  h.session.shutdown();
  h.replaceEntries([{ type: "usage", usage: usage(7) } as SessionEntry]);
  h.restart();
  assert.match(plain(h.footer())[1], /↑100 ↓7 /);
});

test("the footer names the provider, the model and the thinking level Pi reports", () => {
  const h = harness({ model: { provider: "faux", id: "scripted", contextWindow: 200_000 } as ChromeContext["model"] });
  const line = plain(h.footer())[0];
  assert.match(line, /\(faux\) scripted · high/);
});

test("the footer draws the session name and whether Pi compacts on its own", () => {
  const named = harness({ sessionName: "footer pass" });
  assert.match(plain(named.footer())[0], /myproj · footer pass · ⎇ feat\/x/);
  assert.match(plain(named.footer())[1], /◔ 0\.5% \(1\.0k\/200k\) auto/);

  const manual = harness({ settings: { compaction: { enabled: false } } });
  assert.doesNotMatch(plain(manual.footer())[1], /auto/);
});

test("the footer draws the branch counts and the line diff after the branch", async () => {
  const h = harness();
  h.footer();
  await h.flush();
  const line = plain(h.footer())[0];
  assert.match(line, /myproj · ⎇ feat\/x ↑2 ↓1 \+6 −1/, line);
});

test("a clean repository leaves the counts off the row", async () => {
  const h = harness();
  h.setGit({ ahead: 0, behind: 0, added: 0, deleted: 0 });
  h.footer();
  await h.flush();
  const line = plain(h.footer())[0];
  assert.match(line, /myproj · ⎇ feat\/x/, line);
  assert.doesNotMatch(line, /↑|↓|\+|−/, line);
});

test("the repository is read once per interval, not once per frame", async () => {
  const h = harness();
  h.footer();
  await h.flush();
  h.footer();
  h.footer();
  assert.equal(h.gitReads(), 1);

  // Two seconds later the reading has expired, so the next frame asks git again.
  h.now(12_000);
  h.footer();
  await h.flush();
  assert.equal(h.gitReads(), 2);
});

test("a failed repository reading warns once and keeps the last one", async () => {
  const h = harness();
  h.footer();
  await h.flush();
  h.setGitError(new Error("git exploded"));
  h.now(12_000);
  h.footer();
  await h.flush();
  assert.equal(h.notified.length, 1);
  assert.match(h.notified[0] ?? "", /git exploded/);
  assert.match(plain(h.footer())[0], /↑2 ↓1/, "the last reading stays on the row");

  h.now(14_000);
  h.footer();
  await h.flush();
  assert.equal(h.notified.length, 1, "one warning per session");
});

test("a restart drops the old reading and asks git again", async () => {
  const h = harness();
  h.footer();
  await h.flush();
  assert.equal(h.gitReads(), 1);

  h.session.shutdown();
  h.restart();
  h.footer();
  await h.flush();
  assert.equal(h.gitReads(), 2);
});
