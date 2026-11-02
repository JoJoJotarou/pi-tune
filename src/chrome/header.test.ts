import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { headerLine } from "./header.ts";

const theme = testTheme("dark");

test("header shows the colored brand, cwd basename and /hotkeys at width 100", () => {
  const line = headerLine({ version: "1.4.0", cwd: "m4-chrome" }, 100, theme);
  assert.equal(visibleWidth(line), 100);
  assert.ok(line.startsWith(`${theme.bold(theme.fg("accent", "π"))} ${theme.fg("text", "pi 1.4.0")}`), line);
  assert.ok(line.includes(theme.fg("muted", " · m4-chrome")), line);
  assert.ok(line.endsWith(theme.fg("dim", "/hotkeys")), line);
});

test("header stays one row and fits width 40", () => {
  const line = headerLine({ version: "1.4.0", cwd: "a-very-long-project-name" }, 40, theme);
  assert.ok(visibleWidth(line) <= 40);
  assert.ok(line.includes("π"), line);
  assert.ok(line.includes("pi 1.4.0"), line);
  assert.ok(line.includes("…"), line);
  assert.ok(line.includes("/hotkeys"), line);
});
