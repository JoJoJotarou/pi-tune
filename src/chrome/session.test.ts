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
  entries: SessionEntry[];
  setEditorText(text: string): void;
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

function harness(): Harness {
  const notified: string[] = [];
  const entries: SessionEntry[] = [];
  let editorText = "";
  let nowMs = 10_000;
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
    sessionManager: { getEntries: () => entries },
    getContextUsage: () => ({ tokens: 1_000, contextWindow: 200_000, percent: 0.5 }),
    model: undefined,
  };
  const host: ChromeHost = {
    commands: () => [{ source: "skill" }, { source: "skill" }, { source: "builtin" }],
    allTools: () => [{ name: "read" }, { name: "mcp__docs__fetch" }],
    mcpServers: () => [{ name: "docs" }],
    settings: () => ({}),
    agentDir: () => "/tmp/pi-tune-session-test-no-such-dir",
    now: () => nowMs,
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
    entries,
    setEditorText: (text) => {
      editorText = text;
    },
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
  h.entries.push({ type: "usage", usage: usage(50) } as SessionEntry);

  const header = plain(h.header())[0];
  assert.match(header, /2 skills/);
  assert.match(header, /MCP 1\/1/);
  assert.match(header, /myproj/);

  const footer = plain(h.footer());
  assert.match(footer[0], /myproj \(feat\/x\)/);
  assert.match(footer[0], /↑100 ↓50 \$0\.250 · 0\.5%\/200k \(auto\)/);
  assert.match(footer[0], /commands/);
  assert.equal(footer[1], "1 thread");
});

test("the focus check warns once per session, then keeps the hints", () => {
  const h = harness();
  h.footer();
  h.footer();
  assert.equal(h.notified.length, 1);
  assert.match(h.notified[0], /^pi-tune chrome: /);
  assert.match(plain(h.footer())[0], /commands/);
});

test("a typed draft during a run shows the steer hints", () => {
  const h = harness();
  h.setEditorText("fix it");
  h.session.agentStart();
  assert.match(plain(h.footer())[0], /steer/);

  h.session.agentSettled();
  const line = plain(h.footer())[0];
  assert.doesNotMatch(line, /steer/);
  assert.match(line, /files/);
});

test("ttft and the rate come from the stream clock", () => {
  const h = harness();
  h.session.turnStart();
  h.now(12_500);
  h.session.messageUpdate(streamUpdate("text_delta", 10));
  h.now(15_000);
  const streaming = plain(h.footer())[0];
  assert.match(streaming, /4 tok\/s/);
  assert.match(streaming, /TTFT 2\.5s/);

  h.now(17_000);
  h.session.messageEnd(streamEnd(40));
  assert.match(plain(h.footer())[0], /9 tok\/s/);
});

test("editor stash and btw mode change the hints", () => {
  const h = harness();
  h.session.editorReady();
  h.setEditorText("note");
  assert.match(plain(h.footer())[0], /stash/);

  h.setEditorText("");
  h.session.editorStash(true);
  assert.match(plain(h.footer())[0], /restore/);

  h.session.btwMode(true);
  const line = plain(h.footer())[0];
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

  h.entries.length = 0;
  h.setEditorText("");
  h.restart();
  const restarted = plain(h.footer())[0];
  assert.match(restarted, /myproj/);
  assert.doesNotMatch(restarted, /tok\/s/);
  assert.doesNotMatch(restarted, /TTFT/);
  assert.doesNotMatch(restarted, /steer/);
});
