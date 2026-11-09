import assert from "node:assert/strict";
import { homedir } from "node:os";
import { test } from "node:test";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import {
  compactNumber,
  type FooterParts,
  type FooterStats,
  footerLine,
  formatContextPercent,
  formatContextReading,
  formatCost,
  streamRate,
  tildePath,
} from "./footer.ts";

const theme = testTheme("dark");

const stats: FooterStats = {
  input: 35_000,
  output: 18_000,
  cacheRead: 1_600_000,
  cacheWrite: 12_000,
  cost: 0.123,
  contextTokens: 53_000,
  contextPercent: 5.3,
  contextWindow: 1_000_000,
  rate: 48,
};

const parts: FooterParts = {
  project: "pi-tune",
  branch: "feat/m4-chrome",
  hints: "/ commands · @ files · ! shell · ctrl+s stash",
  stats,
  identity: { model: "scripted", thinking: "high", level: "high" },
};

function plain(lines: readonly string[]): string[] {
  return lines.map((line) => stripTerminalSequences(line));
}

test("streamRate shows the live rate only after a full second of writing", () => {
  const t0 = 1_000_000;
  assert.equal(streamRate(96, t0, t0 + 999), undefined);
  assert.equal(streamRate(96, t0, t0 + 2000), 48);
  assert.equal(streamRate(30, t0, t0 + 3000), 10);
  assert.equal(streamRate(0, t0, t0 + 2000), undefined);
  assert.equal(streamRate(96, 0, t0 + 2000), undefined);
});

test("compactNumber uses Pi's k and M thresholds", () => {
  assert.equal(compactNumber(999), "999");
  assert.equal(compactNumber(1000), "1.0k");
  assert.equal(compactNumber(9999), "10.0k");
  assert.equal(compactNumber(10_000), "10k");
  assert.equal(compactNumber(35_000), "35k");
  assert.equal(compactNumber(999_999), "1000k");
  assert.equal(compactNumber(1_000_000), "1.0M");
  assert.equal(compactNumber(9_999_999), "10.0M");
  assert.equal(compactNumber(10_000_000), "10M");
});

test("context readings keep one decimal below ten percent", () => {
  assert.equal(formatContextPercent(5.3), "5.3%");
  assert.equal(formatContextPercent(9.9), "9.9%");
  assert.equal(formatContextPercent(10), "10%");
  assert.equal(formatContextPercent(31.5), "32%");
  assert.equal(formatContextPercent(null), "?");
  assert.equal(formatContextReading(stats), "5.3% (53k/1.0M)");
  assert.equal(formatContextReading({ ...stats, contextTokens: null, contextPercent: null }), "? (?/1.0M)");
});

test("the footer has an identity row and a pill row", () => {
  const lines = plain(footerLine(parts, 120, theme));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /pi-tune · ⎇ feat\/m4-chrome/);
  assert.match(lines[0], /scripted · high/);
  assert.doesNotMatch(lines[0], /tok|%/);

  assert.match(lines[1], /\/ commands/);
  assert.match(lines[1], /≡ 1\.7M tok/);
  assert.match(lines[1], /96% cached/);
  assert.match(lines[1], /\$0\.12/);
  assert.match(lines[1], /↯ 48 tok\/s/);
  assert.match(lines[1], /◔ 5\.3% \(53k\/1\.0M\)/);
  for (const line of lines) assert.ok(visibleWidth(line) <= 120, `${visibleWidth(line)}: ${line}`);
  assert.equal(visibleWidth(lines[0]), 120, "the identity row fills the width");
});

test("key hints yield before any pill, so the readings survive the narrowing", () => {
  const medium = plain(footerLine(parts, 80, theme))[1];
  assert.doesNotMatch(medium, /commands/, "the hints go before a pill does");
  assert.match(medium, /≡ 1\.7M tok · 96% cached · \$0\.12/, medium);
  assert.match(medium, /↯ 48 tok\/s/, medium);
  assert.match(medium, /◔ 5\.3% \(53k\/1\.0M\)/, medium);

  // Below that the pills yield in their own order: cost, the context reading, then speed.
  const narrow = plain(footerLine(parts, 40, theme))[1];
  assert.doesNotMatch(narrow, /commands|\$/, narrow);
  assert.match(narrow, /≡ 1\.7M tok · 96% cached/, narrow);
  assert.doesNotMatch(narrow, /↯/, "speed yields before the token and context pills");
  assert.match(narrow, /◔ 5\.3%/, narrow);
  assert.ok(visibleWidth(narrow) <= 40);

  const tiny = plain(footerLine(parts, 20, theme))[1];
  assert.doesNotMatch(tiny, /tok/);
  assert.match(tiny, /◔ 5\.3%/);
});

test("the context reading shows the used and total tokens", () => {
  const line = plain(footerLine({ ...parts, hints: "" }, 120, theme))[1];
  assert.match(line, /◔ 5\.3% \(53k\/1\.0M\)/);
});

test("the branch yields its middle before the model leaves the identity row", () => {
  const narrow = plain(footerLine({ ...parts, hints: "" }, 40, theme))[0];
  assert.match(narrow, /pi-tune · ⎇ feat\/…hrome/);
  assert.match(narrow, /scripted · high/);

  const tiny = plain(footerLine({ ...parts, hints: "" }, 20, theme))[0];
  assert.match(tiny, /pi-tune/);
  assert.ok(!tiny.includes("scripted"), tiny);
});

test("the identity row falls back to the project alone", () => {
  const line = plain(footerLine({ ...parts, branch: undefined, hints: "" }, 40, theme))[0];
  assert.match(line, /^pi-tune/);
  assert.doesNotMatch(line, /\(|⎇/);
});

const git = { ahead: 2, behind: 1, added: 6, deleted: 1 };

test("the identity row draws the git counts and the line diff after the branch", () => {
  const line = plain(footerLine({ ...parts, git, hints: "" }, 120, theme))[0];
  assert.match(line, /pi-tune · ⎇ feat\/m4-chrome ↑2 ↓1 \+6 −1/, line);
  assert.match(line, /scripted · high/, line);
});

test("a zero git count stays off the row", () => {
  const clean = { ...parts, git: { ahead: 0, behind: 0, added: 0, deleted: 0 }, hints: "" };
  assert.match(plain(footerLine(clean, 120, theme))[0], /pi-tune · ⎇ feat\/m4-chrome\s+scripted · high/);

  const behindOnly = { ...parts, git: { ahead: 0, behind: 3, added: 2, deleted: 0 }, hints: "" };
  const line = plain(footerLine(behindOnly, 120, theme))[0] ?? "";
  assert.match(line, /feat\/m4-chrome ↓3 \+2 /, line);
  assert.doesNotMatch(line, /↑|−/, line);
});

test("the git counts leave before the branch does", () => {
  const narrow = plain(footerLine({ ...parts, git, hints: "" }, 50, theme))[0] ?? "";
  assert.match(narrow, /↑2 ↓1 \+6 −1/, narrow);
  assert.match(narrow, /feat…rome/, narrow);

  const tighter = plain(footerLine({ ...parts, git, hints: "" }, 40, theme))[0] ?? "";
  assert.doesNotMatch(tighter, /↑|↓|\+|−/, tighter);
  assert.match(tighter, /pi-tune · ⎇ feat\/…hrome/, tighter);
});

test("tildePath spends the row on the path instead of the home directory", () => {
  assert.equal(tildePath("/Users/me/proj", "/Users/me"), "~/proj");
  assert.equal(tildePath("/Users/me", "/Users/me"), "~");
  assert.equal(tildePath("/Users/men/proj", "/Users/me"), "/Users/men/proj");
  assert.equal(tildePath("/srv/proj", "/Users/me"), "/srv/proj");
  assert.equal(tildePath("/", "/"), "/");
});

test("the identity row draws the cwd relative to home", () => {
  const path = `${homedir()}/Developer/pi-tune`;
  const line = plain(footerLine({ ...parts, cwd: path, hints: "" }, 160, theme))[0];
  assert.match(line, /~\/Developer\/pi-tune · ⎇ feat\/m4-chrome/, line);
  assert.ok(!line.includes(homedir()), line);
});

test("the cache rate is a share of the token total printed beside it", () => {
  // 1.6M cache reads out of 1.665M tokens in total: the percentage divides the numbers on the same row.
  const line = plain(footerLine({ ...parts, hints: "" }, 120, theme))[1] ?? "";
  assert.match(line, /≡ 1\.7M tok · 96% cached/, line);

  const cold = { ...parts, stats: { ...stats, cacheRead: 0 }, hints: "" };
  assert.match(plain(footerLine(cold, 120, theme))[1] ?? "", /≡ 65k tok · 0% cached/);

  const empty = { ...parts, stats: { ...stats, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, hints: "" };
  assert.doesNotMatch(plain(footerLine(empty, 120, theme))[1] ?? "", /≡/, "no tokens, no share to print");
});

test("the cost is grouped, and a sub-cent session is not free", () => {
  assert.equal(formatCost(0), "");
  assert.equal(formatCost(0.001), "<$0.01");
  assert.equal(formatCost(0.01), "$0.01");
  assert.equal(formatCost(0.42), "$0.42");
  assert.equal(formatCost(3.5), "$3.50");
  assert.equal(formatCost(1234.567), "$1,234.57");
  assert.equal(formatCost(1_234_567.891), "$1,234,567.89");
});

test("the cost rides in the token pill and leaves with it", () => {
  const wide = plain(footerLine({ ...parts, hints: "" }, 120, theme))[1] ?? "";
  assert.match(wide, /≡ 1\.7M tok · 96% cached · \$0\.12/, wide);

  const narrow = plain(footerLine({ ...parts, hints: "" }, 66, theme))[1] ?? "";
  assert.match(narrow, /≡ 1\.7M tok · 96% cached/, narrow);
  assert.doesNotMatch(narrow, /\$/, narrow);
});

const cwd = "/Users/me/Developer/github/personal/pi-tune";

test("the identity row draws the full path while it fits", () => {
  const wide = plain(footerLine({ ...parts, cwd, hints: "" }, 160, theme))[0];
  assert.match(wide, new RegExp(`${cwd} · ⎇ feat/m4-chrome`), wide);
  assert.match(wide, /scripted · high/, wide);

  // The branch goes before the path does: the path plus the model still fits here.
  const medium = plain(footerLine({ ...parts, cwd, hints: "" }, 70, theme))[0];
  assert.match(medium, new RegExp(cwd), medium);
  assert.doesNotMatch(medium, /feat/, medium);
  assert.match(medium, /scripted · high/, medium);
});

test("the identity row falls back to the project name when the path does not fit", () => {
  const narrow = plain(footerLine({ ...parts, cwd, hints: "" }, 40, theme))[0];
  assert.doesNotMatch(narrow, /Users/, narrow);
  assert.match(narrow, /pi-tune · ⎇ feat\/…hrome/, narrow);
  assert.match(narrow, /scripted · high/, narrow);

  const tiny = plain(footerLine({ ...parts, cwd, hints: "" }, 20, theme))[0];
  assert.equal(tiny.trimEnd(), "pi-tune");
});

test("a session without identity still draws both rows", () => {
  const lines = plain(footerLine({ ...parts, identity: undefined }, 120, theme));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /pi-tune · ⎇ feat\/m4-chrome/);
  assert.doesNotMatch(lines[0], /scripted/);
  assert.match(lines[1], /≡/);
});

test("extension statuses take a dim third line sorted by key", () => {
  const lines = footerLine(
    {
      ...parts,
      statuses: [
        ["zeta", "2 warnings"],
        ["alpha", "build\nok"],
      ],
    },
    120,
    theme,
  );
  assert.equal(lines.length, 3);
  assert.equal(lines[2], truncateToWidth(theme.fg("dim", "build ok 2 warnings"), 120));

  const cut = footerLine({ project: "pi-tune", stats, statuses: [["long", "x".repeat(80)]] }, 20, theme)[2];
  assert.ok(visibleWidth(cut) <= 20);
});

test("the context pill turns warning and error as the window fills", () => {
  const warning = footerLine({ ...parts, stats: { ...stats, contextPercent: 75 } }, 120, theme)[1] ?? "";
  assert.ok(warning.includes(theme.fg("warning", "75%")), warning);
  const error = footerLine({ ...parts, stats: { ...stats, contextPercent: 95 } }, 120, theme)[1] ?? "";
  assert.ok(error.includes(theme.fg("error", "95%")), error);
});

test("the footer fills the input block width on the identity row", () => {
  for (const width of [40, 80, 120]) {
    const [line] = footerLine(parts, width, theme);
    assert.equal(visibleWidth(line), width, `${width}: ${JSON.stringify(line)}`);
  }
});

test("footer never exceeds tiny widths", () => {
  for (const width of [1, 5, 10, 20, 30, 40, 80, 120]) {
    for (const line of footerLine(parts, width, theme)) {
      assert.ok(visibleWidth(line) <= width, `${width}: ${visibleWidth(line)}`);
    }
  }
});

test("the thinking color follows the level Pi was given", () => {
  const low = footerLine({ ...parts, identity: { model: "scripted", thinking: "low", level: "low" } }, 120, theme)[0];
  const max = footerLine({ ...parts, identity: { model: "scripted", thinking: "max", level: "max" } }, 120, theme)[0];
  assert.ok(low?.includes(theme.getThinkingBorderColor("low")("low")), low ?? "");
  assert.ok(max?.includes(theme.getThinkingBorderColor("max")("max")), max ?? "");
});
