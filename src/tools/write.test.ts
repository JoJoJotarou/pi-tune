import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createWriteTool, initTheme } from "@earendil-works/pi-coding-agent";
import {
  KeybindingsManager,
  setKeybindings,
  stripTerminalSequences,
  TUI_KEYBINDINGS,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { testTheme } from "../../test/theme.ts";
import { clearWriteRecords, planWrite, recordWriteTarget, renderWriteLines, writeRecord } from "./write.ts";

initTheme("dark");
setKeybindings(
  new KeybindingsManager({
    ...TUI_KEYBINDINGS,
    "app.tools.expand": { defaultKeys: "ctrl+o", description: "Toggle tool output" },
  }),
);

const theme = testTheme();

function dir(): string {
  return mkdtempSync(join(tmpdir(), "pi-tune-write-"));
}

function lines(count: number): string {
  return `${Array.from({ length: count }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n")}\n`;
}

function plain(rendered: string[]): string[] {
  return rendered.map(stripTerminalSequences);
}

test("recordWriteTarget tells a missing file from an existing one", async () => {
  const cwd = dir();
  writeFileSync(join(cwd, "old.txt"), "one\ntwo\n");

  await recordWriteTarget("new", cwd, "missing.txt");
  assert.deepEqual(writeRecord("new"), { existed: false });

  await recordWriteTarget("old", cwd, "old.txt");
  assert.deepEqual(writeRecord("old"), { existed: true, oldText: "one\ntwo\n" });
});

test("a target over 1 MB or unreadable keeps only that it existed", async () => {
  const cwd = dir();
  writeFileSync(join(cwd, "big.txt"), "x".repeat(1024 * 1024 + 1));
  mkdirSync(join(cwd, "folder"));

  await recordWriteTarget("big", cwd, "big.txt");
  assert.deepEqual(writeRecord("big"), { existed: true });

  await recordWriteTarget("folder", cwd, "folder");
  assert.deepEqual(writeRecord("folder"), { existed: true });
});

test("clearWriteRecords forgets every call", async () => {
  const cwd = dir();
  await recordWriteTarget("one", cwd, "missing.txt");
  assert.notEqual(writeRecord("one"), undefined);
  clearWriteRecords();
  assert.equal(writeRecord("one"), undefined);
});

test("a new file is named by its line count and shows numbered rows", async () => {
  const cwd = dir();
  const content = lines(2);
  await recordWriteTarget("small", cwd, "src/new.ts");
  await createWriteTool(cwd).execute("write-test", { path: "src/new.ts", content });

  const plan = planWrite(writeRecord("small"), content);
  assert.deepEqual(plan, { meta: "new · 2 lines", body: "lines" });
  assert.deepEqual(plain(renderWriteLines("src/new.ts", content, false, 80, theme)), [
    "1 │ const value1 = 1;",
    "2 │ const value2 = 2;",
  ]);
});

test("a fifteen-line new file shows the first three rows and the fold marker", () => {
  const content = lines(15);
  assert.deepEqual(plain(renderWriteLines("new.ts", content, false, 80, theme)), [
    " 1 │ const value1 = 1;",
    " 2 │ const value2 = 2;",
    " 3 │ const value3 = 3;",
    "… 12 more lines · click to expand",
  ]);

  const expanded = plain(renderWriteLines("new.ts", content, true, 80, theme));
  assert.equal(expanded.length, 15);
  assert.equal(expanded[0], " 1 │ const value1 = 1;");
  assert.equal(expanded[14], "15 │ const value15 = 15;");
});

test("an overwrite with old text diffs and counts its changes", async () => {
  const cwd = dir();
  const oldText = lines(8);
  writeFileSync(join(cwd, "README.md"), oldText);
  await recordWriteTarget("overwrite", cwd, "README.md");

  const content = `${oldText.replace("const value3 = 3;", "const value3 = 30;")}const extra = 0;\n`;
  await createWriteTool(cwd).execute("write-test", { path: "README.md", content });
  const record = writeRecord("overwrite");
  assert.deepEqual(record, { existed: true, oldText });

  const plan = planWrite(record, content);
  assert.equal(plan.meta, "overwrite · +2 −1");
  assert.equal(plan.body, "diff");
  assert.match(plan.diff ?? "", /^ {2}1 const value1 = 1;$/m);
  assert.match(plan.diff ?? "", /^- 3 const value3 = 3;$/m);
  assert.match(plan.diff ?? "", /^\+ 3 const value3 = 30;$/m);
});

test("a large overwrite is still a diff; folding happens when it is rendered", () => {
  const oldText = lines(12);
  const content = Array.from({ length: 12 }, (_, index) => `const value${index + 1} = ${(index + 1) * 10};`).join("\n");
  const plan = planWrite({ existed: true, oldText }, `${content}\n`);
  assert.equal(plan.meta, "overwrite · +12 −12");
  assert.equal(plan.body, "diff");
});

test("an overwrite without old text shows the new lines and a write without a record has no body", () => {
  assert.deepEqual(planWrite({ existed: true }, lines(6)), { meta: "overwrite", body: "lines" });
  assert.deepEqual(planWrite(undefined, lines(4)), { meta: "4 lines", body: "none" });
});

test("write rows never exceed the width, at 80 and 40", () => {
  const content = lines(15);
  for (const width of [80, 40]) {
    for (const expanded of [false, true]) {
      for (const row of renderWriteLines("a-reasonably-long-file-name.ts", content, expanded, width, theme)) {
        assert.ok(visibleWidth(row) <= width, `width ${width}: ${JSON.stringify(row)}`);
      }
    }
  }
});
