import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import {
  type HeaderParts,
  renderHeader as renderHeaderLines,
  statusBackground,
  type ToolStatus,
  toolBgToken,
  toolStatus,
} from "./header.ts";

const theme = testTheme();

function plain(line: string): string {
  return stripTerminalSequences(line);
}

/** A collapsed header as one string: every header below that is not expanded is a single line. */
function renderHeader(parts: HeaderParts, width: number): string {
  return renderHeaderLines(parts, width, theme).join("\n");
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
    const line = plain(renderHeader({ status, name: "bash", summary: "ls -la" }, 80));
    assert.equal(line.trimEnd(), `${icons[status]} bash ls -la`);
  }
});

test("icon, name and summary take their colors from the theme", () => {
  const raw = renderHeader({ status: "error", name: "bash", summary: "false" }, 80);
  assert.ok(raw.includes(theme.fg("error", "✗")));
  assert.ok(raw.includes(theme.bold("bash")));
  assert.ok(raw.includes(theme.fg("accent", "false")));
});

test("meta and duration are right-aligned at the right edge", () => {
  const width = 60;
  const both = plain(
    renderHeader({ status: "success", name: "bash", summary: "seq 1 40", meta: "exit 1", durationMs: 1240 }, width),
  );
  assert.equal(visibleWidth(both), width);
  assert.ok(both.startsWith("✓ bash seq 1 40"));
  assert.ok(both.endsWith("exit 1 · 1.2s"));

  const metaOnly = plain(renderHeader({ status: "success", name: "bash", summary: "seq 1 40", meta: "exit 1" }, width));
  assert.equal(visibleWidth(metaOnly), width);
  assert.ok(metaOnly.endsWith("exit 1"));
  assert.ok(!metaOnly.includes("·"));

  const durationOnly = plain(
    renderHeader({ status: "success", name: "bash", summary: "seq 1 40", durationMs: 1240 }, width),
  );
  assert.equal(visibleWidth(durationOnly), width);
  assert.ok(durationOnly.endsWith("1.2s"));
  assert.ok(!durationOnly.includes("·"));
});

test("the right part is dimmed", () => {
  const raw = renderHeader({ status: "success", name: "bash", summary: "seq", meta: "exit 1", durationMs: 1240 }, 80);
  assert.ok(raw.includes(theme.getFgAnsi("dim")));
});

test("cuts the summary first, keeping meta and duration", () => {
  const width = 40;
  const line = plain(
    renderHeader({ status: "success", name: "bash", summary: "x".repeat(80), meta: "exit 3", durationMs: 1240 }, width),
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
    renderHeader({ status: "success", name: "bash", summary: "x".repeat(80), meta: "exit 3", durationMs: 1240 }, width),
  );
  assert.equal(visibleWidth(line), width);
  assert.ok(!line.includes("exit"));
  assert.ok(line.endsWith("1.2s"));
  assert.ok(line.includes("…"));
});

test("drops the duration when the summary cannot shrink further", () => {
  const width = 20;
  const line = plain(
    renderHeader({ status: "success", name: "bash", summary: "x".repeat(80), meta: "exit 3", durationMs: 1240 }, width),
  );
  assert.equal(visibleWidth(line), width);
  assert.ok(!line.includes("exit"));
  assert.ok(!line.includes("1.2s"));
  assert.ok(line.startsWith("✓ bash "));
  assert.ok(line.includes("…"));
});

test("measures CJK text in terminal columns", () => {
  const fitting = plain(renderHeader({ status: "running", name: "bash", summary: "中文" }, 20));
  assert.equal(visibleWidth(fitting), 20);
  assert.ok(fitting.includes("中文"));

  const cut = plain(renderHeader({ status: "running", name: "bash", summary: "中文命令很长很长很长很长" }, 20));
  assert.equal(visibleWidth(cut), 20);
  assert.ok(cut.startsWith("● bash 中文"));
  assert.ok(cut.includes("…"));
});

test("an expanded header wraps the summary instead of cutting it", () => {
  const summary = Array.from({ length: 20 }, (_, index) => `tok${index + 1}`).join(" ");
  for (const width of [80, 40, 20]) {
    const lines = renderHeaderLines({ status: "success", name: "bash", summary, expanded: true }, width, theme).map(
      plain,
    );
    assert.ok(lines.length > 1, `width ${width}: ${lines.join("\n")}`);
    assert.ok(!lines.some((line) => line.includes("...")), lines.join("\n"));
    for (const line of lines) assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(line)}`);
    assert.equal(lines.join(" ").replace(/\s+/g, " "), `✓ bash ${summary}`);
  }
});

test("an expanded header keeps its line breaks and wraps CJK without overflowing", () => {
  const lines = renderHeaderLines(
    { status: "success", name: "bash", summary: "echo one\necho 中文中文中文中文中文", expanded: true },
    20,
    theme,
  ).map(plain);
  assert.equal(lines[0], "✓ bash echo one");
  for (const line of lines) assert.ok(visibleWidth(line) <= 20, JSON.stringify(line));
  // Every continuation line starts under the first one, so its own text follows that indent.
  assert.equal(
    lines
      .slice(1)
      .map((line) => line.trim())
      .join(""),
    "echo 中文中文中文中文中文",
  );
});

test("an expanded header keeps the right part on the first line when it fits beside the summary", () => {
  const lines = renderHeaderLines(
    { status: "success", name: "read", summary: "README.md", meta: "3 lines", durationMs: 40, expanded: true },
    60,
    theme,
  ).map(plain);
  assert.equal(lines.length, 1);
  assert.equal(visibleWidth(lines[0]), 60);
  assert.ok(lines[0].startsWith("✓ read README.md "), lines[0]);
  assert.ok(lines[0].endsWith("3 lines · 0.0s"), lines[0]);
});

test("an expanded header closes on its own line with the right part when the summary needs the room", () => {
  const lines = renderHeaderLines(
    { status: "error", name: "bash", summary: "x".repeat(60), meta: "exit 3", expanded: true },
    20,
    theme,
  ).map(plain);
  assert.equal(lines[lines.length - 1], `${" ".repeat(20 - 6)}exit 3`);
  assert.ok(lines.length > 1, lines.join("\n"));
  for (const line of lines) assert.ok(visibleWidth(line) <= 20, JSON.stringify(line));
});

test("an expanded header drops a right part wider than the whole line", () => {
  const lines = renderHeaderLines(
    { status: "error", name: "bash", summary: "x", meta: "exit 137", durationMs: 3_725_000, expanded: true },
    12,
    theme,
  ).map(plain);
  assert.ok(!lines.some((line) => line.includes("exit")), lines.join("\n"));
  for (const line of lines) assert.ok(visibleWidth(line) <= 12, JSON.stringify(line));
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
    for (const parts of [...cases, ...cases.map((parts) => ({ ...parts, expanded: true }))]) {
      for (const line of renderHeaderLines(parts, width, theme)) {
        assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(plain(line))}`);
      }
    }
  }
});

test("the status picks the background token Pi uses for that tool status", () => {
  assert.equal(toolBgToken("running"), "toolPendingBg");
  assert.equal(toolBgToken("success"), "toolSuccessBg");
  assert.equal(toolBgToken("error"), "toolErrorBg");
});

test("a painted line opens with the background of its token and survives inner resets", () => {
  for (const status of ["running", "success", "error"] as const) {
    const token = toolBgToken(status);
    const open = theme.bg(token, "").replace("\u001b[49m", "");
    const paint = statusBackground(status, theme);
    assert.ok(paint("plain").startsWith(open));
    const reset = paint(`\u001b[31mred\u001b[0m after`);
    assert.ok(reset.includes(`\u001b[0m${open}`), JSON.stringify(reset));
    assert.ok(reset.endsWith("\u001b[49m"));
  }
});
