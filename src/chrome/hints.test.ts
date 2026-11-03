import assert from "node:assert/strict";
import { test } from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { testTheme } from "../../test/theme.ts";
import { formatHints, hintFor } from "./hints.ts";

initTheme("dark");
const theme = testTheme("dark");

function plain(text: string): string {
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");
}

test("idle hints name commands, files, shell and stash", () => {
  assert.deepEqual(hintFor("idle", { stash: true }), [
    { key: "/", label: "commands" },
    { key: "@", label: "files" },
    { key: "!", label: "shell" },
    { key: "ctrl+s", label: "stash" },
  ]);
  assert.equal(
    plain(formatHints(hintFor("idle", { stash: true }), theme)),
    "/ commands · @ files · ! shell · ctrl+s stash",
  );
});

test("idle hints drop stash when the editor is disabled", () => {
  assert.deepEqual(hintFor("idle", { stash: false }), [
    { key: "/", label: "commands" },
    { key: "@", label: "files" },
    { key: "!", label: "shell" },
  ]);
});

test("busy hints appear only while the editor holds text", () => {
  assert.deepEqual(hintFor("busy-empty", { stash: true }), []);
  assert.deepEqual(hintFor("busy-typing", { stash: true }), [
    { key: "enter", label: "steer" },
    { binding: "app.message.followUp", label: "follow-up" },
  ]);
});
