import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { headerLine } from "./header.ts";

const theme = testTheme("dark");

test("header shows version, path and /hotkeys at width 100", () => {
  const line = headerLine({ version: "1.4.0", cwd: "~/projects/pi-tune" }, 100, theme);
  assert.equal(visibleWidth(line), 100);
  assert.ok(line.includes("π pi 1.4.0 · "), line);
  assert.ok(line.includes("~/projects/pi-tune"), line);
  assert.ok(line.includes("/hotkeys"), line);
});

test("header stays one row and fits width 40", () => {
  const line = headerLine({ version: "1.4.0", cwd: "~/projects/pi-tune/src/chrome/components" }, 40, theme);
  assert.ok(visibleWidth(line) <= 40);
  assert.ok(line.includes("π pi 1.4.0"), line);
  assert.ok(line.includes("…"), line);
  assert.ok(line.includes("/hotkeys"), line);
});
