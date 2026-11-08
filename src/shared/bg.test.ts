import assert from "node:assert/strict";
import { test } from "node:test";
import { testTheme } from "../../test/theme.ts";
import { blockBackground } from "./bg.ts";

const theme = testTheme();
const open = theme.getBgAnsi("toolPendingBg");

test("the block background wraps the text and closes on the terminal default", () => {
  const paint = blockBackground("toolPendingBg", theme);
  assert.ok(paint("hello").startsWith(`${open}hello`), JSON.stringify(paint("hello")));
  assert.ok(paint("hello").endsWith("\u001b[49m"), JSON.stringify(paint("hello")));
});

test("a full reset inside the line does not punch a hole in the block", () => {
  const paint = blockBackground("toolPendingBg", theme);
  const painted = paint(`${theme.fg("text", "one")} two`);
  assert.equal(
    painted.split("\u001b[0m").length - 1,
    painted.split(`\u001b[0m${open}`).length - 1,
    "every reset is followed by the background again",
  );
});
