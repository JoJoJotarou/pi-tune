import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { headerLine, headerRight } from "./header.ts";

const theme = testTheme("dark");
const none = { connected: 0, configured: 0 };

test("header shows the colored brand, cwd basename and the counts at width 100", () => {
  const line = headerLine(
    { version: "1.4.0", cwd: "m4-chrome", skills: 12, mcp: { connected: 2, configured: 3 } },
    100,
    theme,
  );
  assert.equal(visibleWidth(line), 100);
  assert.ok(line.startsWith(`${theme.bold(theme.fg("accent", "π"))} ${theme.fg("text", "pi 1.4.0")}`), line);
  assert.ok(line.includes(theme.fg("muted", " · m4-chrome")), line);
  assert.ok(line.endsWith(theme.fg("dim", "12 skills · MCP 2/3")), line);
});

test("header right uses the singular, omits zero skills and zero MCP servers", () => {
  assert.equal(headerRight({ skills: 1, mcp: none }, theme), theme.fg("dim", "1 skill"));
  assert.equal(headerRight({ skills: 0, mcp: { connected: 2, configured: 3 } }, theme), theme.fg("dim", "MCP 2/3"));
  assert.equal(headerRight({ skills: 3, mcp: none }, theme), theme.fg("dim", "3 skills"));
  assert.equal(headerRight({ skills: 0, mcp: none }, theme), "");
});

test("header right shows MCP when only a server is connected", () => {
  assert.equal(headerRight({ skills: 0, mcp: { connected: 1, configured: 0 } }, theme), theme.fg("dim", "MCP 1/0"));
});

test("header stays one row and fits width 40", () => {
  const line = headerLine(
    { version: "1.4.0", cwd: "a-very-long-project-name", skills: 12, mcp: { connected: 2, configured: 3 } },
    40,
    theme,
  );
  assert.ok(visibleWidth(line) <= 40);
  assert.ok(line.includes("π"), line);
  assert.ok(line.includes("pi 1.4.0"), line);
  assert.ok(line.includes("…"), line);
  assert.ok(line.endsWith(theme.fg("dim", "12 skills · MCP 2/3")), line);
});

test("header drops the right side first when it does not fit", () => {
  const line = headerLine(
    { version: "1.4.0", cwd: "m4-chrome", skills: 12, mcp: { connected: 2, configured: 3 } },
    24,
    theme,
  );
  assert.ok(visibleWidth(line) <= 24, line);
  assert.ok(line.includes("pi 1.4.0"), line);
  assert.equal(line.includes("skills"), false, line);
  assert.equal(line.includes("MCP"), false, line);
});
