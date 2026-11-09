import assert from "node:assert/strict";
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
  streamRate,
} from "./footer.ts";

const theme = testTheme("dark");

const stats: FooterStats = {
  input: 35_000,
  output: 18_000,
  cacheRead: 1_600_000,
  cacheWrite: 12_000,
  cacheHitPercent: 99.5,
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
  assert.match(lines[0], /pi-tune \(feat\/m4-chrome\)/);
  assert.match(lines[0], /scripted · high/);
  assert.doesNotMatch(lines[0], /tok|%/);

  assert.match(lines[1], /\/ commands/);
  assert.match(lines[1], /▤ 1\.7M tok/);
  assert.match(lines[1], /100%/);
  assert.match(lines[1], /\$0\.12/);
  assert.match(lines[1], /↯ 48 tok\/s/);
  assert.match(lines[1], /◔ 5\.3% \(53k\/1\.0M\)/);
  for (const line of lines) assert.ok(visibleWidth(line) <= 120, `${visibleWidth(line)}: ${line}`);
  assert.equal(visibleWidth(lines[0]), 120, "the identity row fills the width");
});

test("narrow rows drop hints, then speed, before the token and context pills", () => {
  const medium = plain(footerLine(parts, 80, theme))[1];
  assert.match(medium, /\/ commands/);
  assert.match(medium, /▤ 1\.7M tok/);
  assert.match(medium, /◔ 5\.3%/, medium);
  assert.doesNotMatch(medium, /↯/, "speed yields before tokens");

  const narrow = plain(footerLine(parts, 40, theme))[1];
  assert.doesNotMatch(narrow, /commands/);
  assert.match(narrow, /▤ 1\.7M tok/);
  assert.match(narrow, /◔ 5\.3%/);
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
  assert.match(narrow, /pi-tune \(feat\/m…chrome\)/);
  assert.match(narrow, /scripted · high/);

  const tiny = plain(footerLine({ ...parts, hints: "" }, 20, theme))[0];
  assert.match(tiny, /pi-tune/);
  assert.ok(!tiny.includes("scripted"), tiny);
});

test("the identity row falls back to the project alone", () => {
  const line = plain(footerLine({ ...parts, branch: undefined, hints: "" }, 40, theme))[0];
  assert.match(line, /^pi-tune/);
  assert.doesNotMatch(line, /\(/);
});

test("a session without identity still draws both rows", () => {
  const lines = plain(footerLine({ ...parts, identity: undefined }, 120, theme));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /pi-tune \(feat\/m4-chrome\)/);
  assert.doesNotMatch(lines[0], /scripted/);
  assert.match(lines[1], /▤/);
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
