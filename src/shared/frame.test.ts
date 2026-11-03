import assert from "node:assert/strict";
import { test } from "node:test";
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { frame, frameBottom, frameRow, frameTop } from "./frame.ts";

const theme = testTheme();
const plain = (line: string) => stripTerminalSequences(line);

test("top border carries the title left and the meta right", () => {
  assert.equal(
    plain(frameTop(30, theme, "border", { left: "view", right: "1–3/3" })),
    "╭─ view ───────────── 1–3/3 ─╮",
  );
});

test("a border without labels is a plain rounded line", () => {
  assert.equal(plain(frameBottom(6, theme, "border")), "╰────╯");
});

test("the right label is cut before the left one and the corners survive", () => {
  const line = plain(
    frameBottom(24, theme, "border", { left: "stashed", right: "workbuddy/deepseek-v4.1-flash · high" }),
  );
  assert.equal(line, "╰─ stashed ─ workbud… ─╯");
});

test("a label with no room left is dropped instead of breaking the border", () => {
  const line = plain(frameTop(12, theme, "border", { left: "a very long title", right: "meta" }));
  assert.equal(visibleWidth(line), 12);
  assert.ok(line.startsWith("╭") && line.endsWith("╮"));
});

test("rows are padded to the full width so nothing behind the frame shows", () => {
  assert.equal(plain(frameRow("hi", 10, theme, "border")), "│ hi     │");
  assert.equal(plain(frameRow("a long line of text", 10, theme, "border")), "│ a long │");
});

test("no frame line is wider than the width it was given", () => {
  for (const width of [0, 1, 2, 3, 8, 40, 100]) {
    const lines = frame(["x".repeat(200)], width, theme, {
      color: "borderAccent",
      title: "title ".repeat(20),
      meta: "meta ".repeat(20),
      hints: "hint ".repeat(30),
    });
    for (const line of lines) assert.equal(visibleWidth(line), width, `width ${width}: ${plain(line)}`);
  }
});
