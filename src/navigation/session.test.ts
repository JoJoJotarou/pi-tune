import assert from "node:assert/strict";
import { test } from "node:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import type { ScrollableTui, Transcript } from "../internals/transcript.ts";
import { frame } from "../shared/frame.ts";
import {
  createNavigationSession,
  type NavigationContext,
  type NavigationHost,
  type NavigationSession,
} from "./session.ts";
import type { TimelineHoverCard } from "./timeline.ts";

type WidgetFactory = (tui: TUI, theme: Theme) => Component & { dispose?(): void };

const TRANSCRIPT: Transcript = {
  prompts: [
    { row: 0, text: "first question" },
    { row: 30, text: "second question" },
  ],
  total: 90,
  key: { width: 80, contentHeight: 90, count: 4, last: undefined },
};

interface Overlay {
  hidden: boolean;
  /** The component Pi was asked to show: the hover card is the second one. */
  component: Component;
}

interface Harness {
  session: NavigationSession;
  /** Every notification as `level: message`, so a warning's level is asserted too. */
  notified: string[];
  /** Every overlay Pi was asked to show, in order; two per mounted rail. */
  overlays: Overlay[];
  /** The picker calls as `title` and the labels it was offered. */
  pickers: { title: string; labels: string[] }[];
  /** The rows the command jumped to. */
  jumps: number[];
  /** Runs `session.start` with a fresh ctx of that mode. */
  start(mode?: NavigationContext["mode"]): void;
  /** Runs the widget factory Pi registered, as Pi does when it mounts the widget, with that theme. */
  mount(theme?: Theme): void;
  /** Runs the `/timeline` handler body with a fresh ctx. */
  command(mode?: NavigationContext["mode"]): Promise<void>;
  /** Makes the internals probe fail, as a Pi it does not know does. */
  loseTranscript(): void;
  /** The prompt list the internals return, or the error that replaces it. */
  setTranscript(next: Transcript | Error): void;
  promptsRead(): number;
  /** The label the picker's user picks; `undefined` cancels. */
  pick(label: string | undefined): void;
}

function harness(): Harness {
  const notified: string[] = [];
  const overlays: Overlay[] = [];
  const pickers: { title: string; labels: string[] }[] = [];
  const jumps: number[] = [];
  let factory: WidgetFactory | undefined;
  let choice: string | undefined;
  let reads = 0;
  let transcript: Transcript | Error = TRANSCRIPT;
  let scrollable: ScrollableTui | undefined = {
    viewportTop: 0,
    scrollBy: () => {},
    hasActiveSelection: () => false,
    terminal: { columns: 100, rows: 30 },
    requestRender: () => {},
  } as unknown as ScrollableTui;

  const host: NavigationHost = {
    scrollable: () => scrollable,
    prompts: () => {
      reads += 1;
      return transcript;
    },
    jumpTo: (_tui, row) => jumps.push(row),
    publish: () => {},
  };

  const tui = {
    showOverlay: (component: Component): OverlayHandle => {
      const overlay: Overlay = { hidden: false, component };
      overlays.push(overlay);
      return {
        hide: () => {
          overlay.hidden = true;
        },
      } as OverlayHandle;
    },
  } as unknown as TUI;

  const ctx = (mode: NavigationContext["mode"] = "tui"): NavigationContext => ({
    mode,
    ui: {
      notify: (message, level) => notified.push(`${level ?? "info"}: ${message}`),
      select: async (title, options) => {
        pickers.push({ title, labels: [...options] });
        return choice;
      },
      setWidget: (_key, content) => {
        if (typeof content === "function") factory = content;
      },
    },
  });

  const session = createNavigationSession(host);
  return {
    session,
    notified,
    overlays,
    pickers,
    jumps,
    start: (mode) => session.start(ctx(mode)),
    mount: (widgetTheme) => {
      if (!factory) throw new Error("session.start did not register the widget");
      factory(tui, widgetTheme ?? testTheme("dark"));
    },
    command: (mode) => session.runTimelineCommand(ctx(mode)),
    loseTranscript: () => {
      scrollable = undefined;
    },
    setTranscript: (next) => {
      transcript = next;
    },
    promptsRead: () => reads,
    pick: (label) => {
      choice = label;
    },
  };
}

/** A started session whose widget Pi has mounted, with the rail in place. */
function mounted(): Harness {
  const h = harness();
  h.start();
  h.mount();
  return h;
}

test("start shows the rail and the card only once Pi mounts the widget", () => {
  const h = harness();
  h.start();
  assert.equal(h.overlays.length, 0, "no overlay before the widget is mounted");

  h.mount();
  assert.deepEqual(
    h.overlays.map((overlay) => overlay.hidden),
    [false, false],
  );
});

test("the overlays read the theme of the latest widget factory call, so a theme change reaches a mounted rail", () => {
  const h = mounted();
  const card = h.overlays[1].component as TimelineHoverCard;
  card.show({ lines: ["a question"], width: 14, row: 1, col: 0 });
  assert.deepEqual(card.render(14), frame(["a question"], 14, testTheme("dark"), { color: "border" }));

  h.mount(testTheme("light"));
  assert.deepEqual(card.render(14), frame(["a question"], 14, testTheme("light"), { color: "border" }));
});

test("a TUI without a scrollable transcript warns once and leaves the feature off", async () => {
  const h = harness();
  h.loseTranscript();
  h.start();
  h.mount();
  h.mount();

  assert.deepEqual(h.notified, ["warning: pi-tune timeline disabled: TUI has no scrollable transcript"]);
  assert.deepEqual(h.overlays, []);
  assert.equal(h.promptsRead(), 0);

  await h.command();
  // The rail never came up, so the command has no transcript to read either.
  assert.deepEqual(h.notified.at(-1), "warning: Timeline needs fullscreen mode");
  assert.equal(h.promptsRead(), 0);
});

test("shutdown hides the overlays and forgets the session, and a second start mounts a new rail", async () => {
  const h = harness();
  h.start();
  h.mount();

  h.session.shutdown();
  assert.deepEqual(
    h.overlays.map((overlay) => overlay.hidden),
    [true, true],
  );
  await h.command();
  assert.deepEqual(h.notified, ["warning: Timeline needs fullscreen mode"]);

  h.start();
  h.mount();
  assert.deepEqual(
    h.overlays.map((overlay) => overlay.hidden),
    [true, true, false, false],
  );
});

test("the timeline command lists the session's prompts and jumps to the picked one", async () => {
  const h = mounted();
  h.pick("2  second question");
  await h.command();

  assert.deepEqual(h.pickers, [
    { title: "Prompts in this session", labels: ["1  first question", "2  second question"] },
  ]);
  assert.deepEqual(h.jumps, [30]);
});

test("a cancelled picker and an unknown label jump nowhere", async () => {
  const h = mounted();
  await h.command();
  assert.deepEqual(h.jumps, []);

  h.pick("a prompt that is not in the list");
  await h.command();
  assert.deepEqual(h.jumps, []);
});

test("the timeline command asks for fullscreen mode outside the TUI", async () => {
  const h = mounted();
  await h.command("rpc");
  assert.deepEqual(h.notified, ["warning: Timeline needs fullscreen mode"]);
  assert.deepEqual(h.pickers, []);
});

test("an unreadable transcript disables the command after one warning and is not read again", async () => {
  const h = mounted();
  h.setTranscript(new Error("chat has no component children"));

  await h.command();
  await h.command();

  assert.deepEqual(h.notified, [
    "warning: pi-tune timeline disabled: chat has no component children",
    "warning: pi-tune timeline disabled: chat has no component children",
  ]);
  assert.equal(h.promptsRead(), 1);
  assert.deepEqual(h.pickers, []);
});
