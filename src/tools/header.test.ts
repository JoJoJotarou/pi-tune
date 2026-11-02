import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { renderHeader, type ToolStatus, toolStatus } from "./header.ts";

const theme = testTheme();

function plain(line: string): string {
  return stripTerminalSequences(line);
}

test("toolStatus stays running until the call has a final result", () => {
  assert.equal(toolStatus({ executionStarted: false, isPartial: false, isError: false }), "running");
  assert.equal(toolStatus({ executionStarted: false, isPartial: false, isError: true }), "running");
  assert.equal(toolStatus({ executionStarted: true, isPartial: true, isError: false }), "running");
  assert.equal(toolStatus({ executionStarted: true, isPartial: true, isError: true }), "running");
  assert.equal(toolStatus({ executionStarted: true, isPartial: false, isError: false }), "success");
  assert.equal(toolStatus({ executionStarted: true, isPartial: false, isError: true }), "error");
});

test("each status draws its own icon", () => {
  const icons: Record<ToolStatus, string> = { running: "●", success: "✓", error: "✗" };
  for (const status of ["running", "success", "error"] as const) {
    const line = plain(renderHeader({ status, name: "bash", summary: "ls -la" }, 80, theme));
    assert.equal(line.trimEnd(), `${icons[status]} bash ls -la`);
  }
});

test("icon, name and summary take their colors from the theme", () => {
  const raw = renderHeader({ status: "error", name: "bash", summary: "false" }, 80, theme);
  assert.ok(raw.includes(theme.fg("error", "✗")));
  assert.ok(raw.includes(theme.bold("bash")));
  assert.ok(raw.includes(theme.fg("accent", "false")));
});

test("meta and duration are right-aligned at the right edge", () => {
  const width = 60;
  const both = plain(
    renderHeader(
      { status: "success", name: "bash", summary: "seq 1 40", meta: "exit 1", durationMs: 1240 },
      width,
      theme,
    ),
  );
  assert.equal(visibleWidth(both), width);
  assert.ok(both.startsWith("✓ bash seq 1 40"));
  assert.ok(both.endsWith("exit 1 · 1.2s"));

  const metaOnly = plain(
    renderHeader({ status: "success", name: "bash", summary: "seq 1 40", meta: "exit 1" }, width, theme),
  );
  assert.equal(visibleWidth(metaOnly), width);
  assert.ok(metaOnly.endsWith("exit 1"));
  assert.ok(!metaOnly.includes("·"));

  const durationOnly = plain(
    renderHeader({ status: "success", name: "bash", summary: "seq 1 40", durationMs: 1240 }, width, theme),
  );
  assert.equal(visibleWidth(durationOnly), width);
  assert.ok(durationOnly.endsWith("1.2s"));
  assert.ok(!durationOnly.includes("·"));
});

test("the right part is dimmed", () => {
  const raw = renderHeader(
    { status: "success", name: "bash", summary: "seq", meta: "exit 1", durationMs: 1240 },
    80,
    theme,
  );
  assert.ok(raw.includes(theme.getFgAnsi("dim")));
});

test("cuts the summary first, keeping meta and duration", () => {
  const width = 40;
  const line = plain(
    renderHeader(
      { status: "success", name: "bash", summary: "x".repeat(80), meta: "exit 3", durationMs: 1240 },
      width,
      theme,
    ),
  );
  assert.equal(visibleWidth(line), width);
  assert.ok(line.endsWith("exit 3 · 1.2s"));
  const match = /^✓ bash (x+…) +exit 3 · 1\.2s$/.exec(line);
  assert.ok(match, line);
  assert.ok(visibleWidth(match[1]) >= 8);
});

test("drops meta before the duration", () => {
  const width = 25;
  const line = plain(
    renderHeader(
      { status: "success", name: "bash", summary: "x".repeat(80), meta: "exit 3", durationMs: 1240 },
      width,
      theme,
    ),
  );
  assert.equal(visibleWidth(line), width);
  assert.ok(!line.includes("exit"));
  assert.ok(line.endsWith("1.2s"));
  assert.ok(line.includes("…"));
});

test("drops the duration when the summary cannot shrink further", () => {
  const width = 20;
  const line = plain(
    renderHeader(
      { status: "success", name: "bash", summary: "x".repeat(80), meta: "exit 3", durationMs: 1240 },
      width,
      theme,
    ),
  );
  assert.equal(visibleWidth(line), width);
  assert.ok(!line.includes("exit"));
  assert.ok(!line.includes("1.2s"));
  assert.ok(line.startsWith("✓ bash "));
  assert.ok(line.includes("…"));
});

test("measures CJK text in terminal columns", () => {
  const fitting = plain(renderHeader({ status: "running", name: "bash", summary: "中文" }, 20, theme));
  assert.equal(visibleWidth(fitting), 20);
  assert.ok(fitting.includes("中文"));

  const cut = plain(renderHeader({ status: "running", name: "bash", summary: "中文命令很长很长很长很长" }, 20, theme));
  assert.equal(visibleWidth(cut), 20);
  assert.ok(cut.startsWith("● bash 中文"));
  assert.ok(cut.includes("…"));
});

test("never renders wider than the given width", () => {
  const cases = [
    { status: "running" as const, name: "bash", summary: "seq 1 40" },
    { status: "success" as const, name: "bash", summary: "x".repeat(80), meta: "exit 1", durationMs: 1240 },
    {
      status: "error" as const,
      name: "bash",
      summary: "中文命令很长很长很长很长",
      meta: "exit 137",
      durationMs: 3_725_000,
    },
  ];
  for (const width of [80, 40, 20]) {
    for (const parts of cases) {
      const line = renderHeader(parts, width, theme);
      assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(plain(line))}`);
    }
  }
});
