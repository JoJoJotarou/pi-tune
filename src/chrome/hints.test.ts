import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme, keyText } from "@earendil-works/pi-coding-agent";
import { testTheme } from "../../test/theme.ts";
import { formatHints, type HintState, hintFor } from "./hints.ts";

initTheme("dark");
const theme = testTheme("dark");

function plain(text: string): string {
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}

const idle: HintState = { draft: "empty", running: false, editor: true, stash: "none", btw: false };

test("a blank editor names the three message prefixes", () => {
  assert.deepEqual(hintFor(idle), [
    { key: "/", label: "commands" },
    { key: "@", label: "files" },
    { key: "!", label: "shell" },
  ]);
  assert.equal(plain(formatHints(hintFor(idle), theme)), "/ commands · @ files · ! shell");
});

test("ctrl+s is only advertised when it does something", () => {
  assert.ok(!plain(formatHints(hintFor(idle), theme)).includes("ctrl+s"), "nothing to stash, no stash held");

  const held: HintState = { ...idle, stash: "held" };
  assert.equal(plain(formatHints(hintFor(held), theme)), "/ commands · @ files · ! shell · ctrl+s restore");

  const draft: HintState = { ...idle, draft: "text" };
  assert.equal(plain(formatHints(hintFor(draft), theme)), "@ files · ctrl+s stash");

  const noEditor: HintState = { ...idle, editor: false };
  assert.ok(!plain(formatHints(hintFor(noEditor), theme)).includes("ctrl+s"), "the editor extension is off");
  assert.ok(!plain(formatHints(hintFor({ ...draft, editor: false }), theme)).includes("ctrl+s"));
});

test("a draft turns off the prefixes that need the start of the message", () => {
  const hints = plain(formatHints(hintFor({ ...idle, draft: "text" }), theme));
  assert.ok(!hints.includes("/ commands"), hints);
  assert.ok(!hints.includes("! shell"), hints);
  assert.ok(hints.includes("@ files"), "@ mentions work anywhere in the message");
});

test("a run keeps the prefixes while the editor is blank and swaps them for steer once text is typed", () => {
  assert.equal(plain(formatHints(hintFor({ ...idle, running: true }), theme)), "/ commands · @ files · ! shell");
  const steering: HintState = { ...idle, running: true, draft: "text" };
  assert.deepEqual(hintFor(steering), [
    { binding: "tui.input.submit", label: "steer" },
    { binding: "app.message.followUp", label: "follow-up" },
  ]);
  assert.equal(
    plain(formatHints(hintFor(steering), theme)),
    `${keyText("tui.input.submit")} steer · ${keyText("app.message.followUp")} follow-up`,
  );
});

test("a btw drawer drops the prefixes it swallows", () => {
  assert.equal(plain(formatHints(hintFor({ ...idle, btw: true }), theme)), "@ files");
  assert.equal(plain(formatHints(hintFor({ ...idle, btw: true, draft: "text" }), theme)), "@ files · ctrl+s stash");
});
