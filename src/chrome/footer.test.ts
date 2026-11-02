import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { compactNumber, type FooterParts, footerLine } from "./footer.ts";

const theme = testTheme("dark");

const parts: FooterParts = {
  path: "~/projects/pi-tune/src/chrome",
  branch: "main",
  hints: "/ commands · @ files · ! shell · ctrl+s stash · alt+o view",
  tokens: { input: 12_000, output: 1500 },
  cachePercent: 42,
  cost: 0.061,
  ctxPercent: 12,
};

const cases: Array<{
  width: number;
  present: string[];
  absent: string[];
}> = [
  { width: 120, present: ["↑12k ↓1.5k", "ctrl+s stash", "(main)", "ctx 12%"], absent: ["cache 42%", "$0.061"] },
  { width: 100, present: ["ctrl+s stash", "(main)", "…", "ctx 12%"], absent: ["↑12k", "cache 42%", "$0.061"] },
  { width: 80, present: ["(main)", "ctx 12%"], absent: ["↑12k", "ctrl+s stash", "cache 42%", "$0.061"] },
  { width: 60, present: ["(main)", "ctx 12%"], absent: ["↑12k", "ctrl+s stash", "cache 42%", "$0.061"] },
  { width: 40, present: ["ctx 12%"], absent: ["(main)", "↑12k", "ctrl+s stash", "cache 42%", "$0.061"] },
];

for (const { width, present, absent } of cases) {
  test(`footer fits width ${width} and keeps ctx`, () => {
    const [line] = footerLine(parts, width, theme);
    assert.ok(visibleWidth(line) <= width, `footer is wider than ${width}`);
    for (const text of present) assert.ok(line.includes(text), `missing ${text} at ${width}`);
    for (const text of absent) assert.ok(!line.includes(text), `unexpected ${text} at ${width}`);
  });
}

test("footer cuts a long path from the left", () => {
  const [line] = footerLine(
    { ...parts, path: "~/projects/pi-tune/src/chrome/components", branch: undefined },
    40,
    theme,
  );
  assert.ok(visibleWidth(line) <= 40);
  assert.ok(line.includes("…"), line);
  assert.ok(line.includes("ctx 12%"), line);
});

test("compact numbers", () => {
  assert.equal(compactNumber(999), "999");
  assert.equal(compactNumber(1500), "1.5k");
  assert.equal(compactNumber(12_000), "12k");
  assert.equal(compactNumber(1_200_000), "1.2M");
});

test("ctx color follows the usage thresholds", () => {
  const at = (percent: number) => footerLine({ path: "~/x", ctxPercent: percent }, 60, theme)[0];
  assert.ok(at(69).includes(theme.fg("dim", "ctx 69%")));
  assert.ok(at(71).includes(theme.fg("warning", "ctx 71%")));
  assert.ok(at(91).includes(theme.fg("error", "ctx 91%")));
});

test("cost is omitted when zero", () => {
  const [line] = footerLine({ ...parts, cost: 0 }, 120, theme);
  assert.ok(!line.includes("$"), line);
});

test("extension statuses use a second line", () => {
  const lines = footerLine({ ...parts, statuses: ["build ok", "2 warnings"] }, 120, theme);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes("build ok · 2 warnings"));
  assert.ok(visibleWidth(lines[1]) <= 120);

  const [cut] = footerLine({ path: "~", statuses: ["a".repeat(80)] }, 20, theme);
  assert.ok(visibleWidth(cut) <= 20);
  assert.equal(footerLine({ path: "~" }, 80, theme).length, 1);
});
