import assert from "node:assert/strict";
import { test } from "node:test";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { compactNumber, type FooterParts, type FooterStats, footerLine, formatStats, streamRate } from "./footer.ts";

const theme = testTheme("dark");

const stats: FooterStats = {
  input: 35_000,
  output: 18_000,
  cacheRead: 1_600_000,
  cacheWrite: 12_000,
  cacheHitPercent: 99.5,
  cost: 0.123,
  contextPercent: 5.3,
  contextWindow: 1_000_000,
  autoCompact: true,
  rate: 48,
};

const parts: FooterParts = {
  project: "pi-tune",
  branch: "feat/m4-chrome",
  hints: "/ commands · @ files · ! shell · ctrl+s stash",
  stats,
};

test("formatStats matches Pi's native footer format", () => {
  assert.equal(formatStats(stats), "↑35k ↓18k R1.6M W12k CH99.5% $0.123 · 5.3%/1.0M (auto) · 48 tok/s");
});

test("formatStats omits zero fields and the rate until one exists", () => {
  assert.equal(
    formatStats({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextPercent: 0,
      contextWindow: 200_000,
      autoCompact: false,
    }),
    "0.0%/200k",
  );
});

test("formatStats mirrors Pi's cache and context rules", () => {
  const base: FooterStats = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    contextPercent: null,
    contextWindow: 1_000_000,
    autoCompact: true,
  };
  assert.equal(formatStats(base), "?/1.0M (auto)");
  assert.equal(formatStats({ ...base, cacheRead: 1000 }), "R1.0k · ?/1.0M (auto)");
  assert.equal(formatStats({ ...base, cacheWrite: 500, cacheHitPercent: 50 }), "W500 CH50.0% · ?/1.0M (auto)");
  assert.equal(formatStats({ ...base, rate: 0 }), "?/1.0M (auto)");
});

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

test("footer drops hints, then cost, then cache fields at narrow widths", () => {
  const wide = footerLine(parts, 120, theme)[0];
  assert.ok(visibleWidth(wide) <= 120);
  assert.ok(!wide.includes("ctrl+s stash"), wide);
  assert.ok(wide.includes("$0.123"), wide);
  assert.ok(wide.includes("CH99.5%"), wide);
  assert.ok(wide.includes("48 tok/s"), wide);
  assert.ok(wide.includes("(feat/m4-chrome)"), wide);

  const medium = footerLine(parts, 80, theme)[0];
  assert.ok(visibleWidth(medium) <= 80);
  assert.ok(!medium.includes("ctrl+s stash"), medium);
  assert.ok(!medium.includes("$"), medium);
  assert.ok(!medium.includes("R1.6M") && !medium.includes("W12k") && !medium.includes("CH"), medium);
  assert.ok(medium.includes("5.3%/1.0M (auto)"), medium);
  assert.ok(medium.includes("48 tok/s"), medium);

  const narrow = footerLine(parts, 40, theme)[0];
  assert.ok(visibleWidth(narrow) <= 40);
  assert.ok(!narrow.includes("(feat/m4-chrome)"), narrow);
  assert.ok(narrow.includes("pi-tune"), narrow);
  assert.ok(narrow.includes("5.3%/1.0M (auto)"), narrow);
});

test("footer shows idle hints and the project basename at roomy widths", () => {
  const roomy: FooterParts = {
    project: "pi-tune",
    branch: "main",
    hints: "/ commands · @ files · ! shell",
    stats: { ...stats, input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, cost: 0.01, rate: undefined },
  };
  const [line] = footerLine(roomy, 120, theme);
  assert.ok(visibleWidth(line) <= 120);
  assert.ok(line.includes("pi-tune (main)"), line);
  assert.ok(line.includes("↑1.2k ↓300"), line);
  assert.ok(line.includes("/ commands"), line);
  assert.ok(!line.includes("↑35k"), line);
  const hintAt = line.indexOf("/ commands");
  const contextAt = line.indexOf("5.3%/");
  assert.ok(hintAt > line.indexOf("(main)") && hintAt < contextAt, line);
});

test("extension statuses take a dim second line sorted by key", () => {
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
  assert.equal(lines.length, 2);
  assert.equal(lines[1], truncateToWidth(theme.fg("dim", "build ok 2 warnings"), 120));
  assert.equal(footerLine(parts, 120, theme).length, 1);

  const cut = footerLine({ project: "pi-tune", stats, statuses: [["long", "x".repeat(80)]] }, 20, theme)[1];
  assert.ok(visibleWidth(cut) <= 20);
});

test("footer never exceeds tiny widths", () => {
  for (const width of [1, 5, 10, 20, 30]) {
    const [line] = footerLine(parts, width, theme);
    assert.ok(visibleWidth(line) <= width, `${width}: ${visibleWidth(line)}`);
  }
});
