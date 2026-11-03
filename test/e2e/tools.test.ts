import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

const files = { "README.md": "# demo\n\nA tiny project.\n" };

const reference: Scenario = {
  files,
  turns: [
    [
      { thinking: "Print the lines and read the README." },
      { tool: "bash", args: { command: "seq 1 40" } },
      { tool: "read", args: { path: "README.md" } },
    ],
    [{ text: "Done: printed 40 lines and read the README." }],
  ],
};

const failure: Scenario = {
  files,
  turns: [[{ tool: "bash", args: { command: "sh -c 'seq 1 20; exit 3'" } }], [{ text: "It failed." }]],
};

const longTokens = Array.from({ length: 35 }, (_, index) => `tok${index + 1}`);
const longCommand = `true # ${longTokens.join(" ")}`;
const longBash: Scenario = {
  files,
  turns: [[{ tool: "bash", args: { command: longCommand } }], [{ text: "Long command done." }]],
};

const heredocLines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
const heredoc: Scenario = {
  files,
  turns: [
    [
      {
        tool: "bash",
        args: { command: `cat > notes.txt <<'EOF'\n${heredocLines.join("\n")}\nEOF` },
      },
    ],
    [{ text: "Wrote notes." }],
  ],
};

function rows(screen: string[]): string[] {
  return screen.map((row) => row.trim());
}

function rowIndex(lines: string[], matcher: string | RegExp, from = 0): number {
  for (let index = from; index < lines.length; index++) {
    if (typeof matcher === "string" ? lines[index].includes(matcher) : matcher.test(lines[index])) {
      return index;
    }
  }
  return -1;
}

function countRows(lines: string[], matcher: RegExp): number {
  return lines.filter((line) => matcher.test(line)).length;
}

function assertRowsInOrder(lines: string[], matchers: (string | RegExp)[], from = 0): void {
  let index = from;
  for (const matcher of matchers) {
    const found = rowIndex(lines, matcher, index);
    assert.ok(found >= index, `expected ${String(matcher)} after row ${index}:\n${lines.join("\n")}`);
    index = found + 1;
  }
}

/** No tool block may name the global expand key: a click expands one block, ctrl+o expands all. */
function assertNoExpandHint(lines: string[], from: number, to = lines.length): void {
  const slice = lines.slice(from, to);
  assert.ok(!slice.some((line) => line.includes("ctrl+o")), slice.join("\n"));
}

/** Rows of the folded body below `from`: everything before the click-to-expand hint, blanks dropped. */
function countBodyRows(lines: string[], from: number): number {
  let count = 0;
  for (let index = from; index < lines.length; index++) {
    if (/click to expand/.test(lines[index])) break;
    if (lines[index] !== "") count++;
  }
  return count;
}

async function closeAfter(pi: PiSession, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } finally {
    await pi.close();
  }
}

test("one-line tool calls hide output until expanded", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: reference, tune: true });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Done:");
    const lines = rows(pi.screen());

    const bash = /^✓ bash seq 1 40/;
    const read = /^✓ read README\.md/;
    assert.equal(countRows(lines, bash), 1, lines.join("\n"));
    assert.equal(countRows(lines, read), 1, lines.join("\n"));

    const first = Math.min(rowIndex(lines, bash), rowIndex(lines, read));
    const last = Math.max(rowIndex(lines, bash), rowIndex(lines, read));
    // Each call is its header between one painted blank row above and below; Pi adds one plain blank row.
    assert.ok(last - first + 1 <= 5, `tool rows span ${last - first + 1} rows:\n${lines.join("\n")}`);

    for (let line = 1; line <= 40; line++) {
      assert.ok(!lines.includes(String(line)), `output line ${line} is visible:\n${lines.join("\n")}`);
    }

    assertNoExpandHint(lines, first, last + 2);
    await pi.shot("tools-collapsed");

    pi.press("ctrl+o");
    await pi.waitFor(/^\s*40\s*$/m);
    await pi.shot("tools-expanded");
  });
});

test("collapsed tool blocks in light theme", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: reference, tune: true, settings: { theme: "light" } });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Done:");
    await pi.shot("tools-collapsed-light");
  });
});

test("a long bash command is fully visible when expanded", { timeout: 180_000 }, async () => {
  assert.ok(longCommand.length >= 200, `command is ${longCommand.length} chars`);
  const pi = await startPi({ scenario: longBash, tune: true, cols: 80, rows: 40 });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Long command done.");
    const collapsed = pi.screen().join("\n");
    assert.ok(!collapsed.includes("tok35"), `the tail of the command shows while collapsed:\n${collapsed}`);

    pi.press("ctrl+o");
    await pi.waitFor("tok35");
    const expanded = pi.screen().join("\n");
    for (const token of longTokens) {
      assert.ok(expanded.includes(token), `command token ${token} was cut from the screen:\n${expanded}`);
    }
    assert.ok(!expanded.includes("click to expand"), expanded);
  });
});

test("failed bash call shows the last lines and a click-to-expand hint", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: failure, tune: true });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("It failed.");
    const lines = rows(pi.screen());

    const header = rowIndex(lines, /^✗ bash\b.*exit 3/);
    assert.ok(header >= 0, `failure header not found:\n${lines.join("\n")}`);

    assertRowsInOrder(lines, [/^18$/, /^19$/, /^20$/, /… 17 more lines · click to expand/], header + 1);
    assertNoExpandHint(lines, header);
    await pi.shot("tools-bash-error");
  });
});

test("heredoc command is summarised on one row", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: heredoc, tune: true });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Wrote notes.");
    const lines = rows(pi.screen());

    assert.ok(rowIndex(lines, "cat > notes.txt <<'EOF' +21 lines") >= 0, lines.join("\n"));
    assert.ok(!lines.includes("line 5"), `heredoc line 5 is visible:\n${lines.join("\n")}`);
  });
});

test("narrow terminal keeps the compact header and does not crash", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: reference, tune: true, cols: 40, rows: 30 });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Done:");
    const crashLog = join(dirname(pi.projectDir), "agent", "pi-tui-crash.log");
    assert.ok(!existsSync(crashLog), `Pi crashed at 40 columns: ${crashLog}`);
    await pi.shot("tools-narrow-40");
  });
});

const summaryFiles = {
  "README.md": "# demo\n\nA tiny project.\n",
  "src/a.ts": "// TODO: first\n// TODO: second\n// TODO: third\n",
  "src/b.ts": "// TODO: only\n",
};

const summarySettings = { defaultTools: ["read", "bash", "edit", "write", "grep", "find", "ls"] };

const summaries: Scenario = {
  files: summaryFiles,
  turns: [
    [
      { tool: "read", args: { path: "README.md" } },
      { tool: "grep", args: { pattern: "TODO", path: "src" } },
      { tool: "find", args: { pattern: "*.ts" } },
      { tool: "ls", args: {} },
    ],
    [{ text: "Summary done." }],
  ],
};

test("collapsed summaries tell what each tool returned", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: summaries, tune: true, cols: 100, rows: 40, settings: summarySettings });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Summary done.");
    const lines = rows(pi.screen());

    const expected: [string, RegExp][] = [
      ["read", /^✓ read README\.md\s+3 lines · /],
      ["grep", /^✓ grep "TODO" in src\s+4 matches · 2 files · /],
      ["find", /^✓ find \*\.ts in \.\s+2 files · /],
      ["ls", /^✓ ls \.\s+1 dir · 1 file · /],
    ];
    for (const [name, matcher] of expected) {
      assert.equal(countRows(lines, matcher), 1, `${name} summary row:\n${lines.join("\n")}`);
    }

    pi.press("ctrl+o");
    await pi.waitFor(/└─ 3 {2}\/\/ TODO: third/);
    const expanded = rows(pi.screen());
    assertNoExpandHint(expanded, rowIndex(expanded, /^✓ read README\.md/), rowIndex(expanded, /^Summary done\.$/));
  });
});

const editServer = `import http from "node:http";

const PORT = 3000;
const HOST = "127.0.0.1";

function requestHandler(req, res) {
  res.setHeader("Content-Type", "text/plain");
  res.end("ok");
}

function startServer() {
  server.listen(PORT, HOST, () => {
    console.log("Server started .");
  });
}
`;

const editBig = `${Array.from({ length: 40 }, (_, index) => `const value${index + 1} = ${index + 1};`).join("\n")}\n`;
const editBigOld = Array.from({ length: 10 }, (_, index) => `const value${index + 11} = ${index + 11};`).join("\n");
const editBigNew = Array.from({ length: 10 }, (_, index) => `const value${index + 11} = ${(index + 11) * 10};`).join(
  "\n",
);

const editFiles = { "src/server.ts": editServer, "src/big.ts": editBig };
const editSettings = { defaultTools: ["read", "bash", "edit", "write", "grep", "find", "ls"] };
const edits: Scenario = {
  files: editFiles,
  turns: [
    [
      {
        tool: "edit",
        args: {
          path: "src/server.ts",
          edits: [
            { oldText: "const PORT = 3000;", newText: "const PORT = Number(process.env.PORT ?? 3000);" },
            {
              oldText: '    console.log("Server started .");',
              newText: "    console.log(`Server started on port ${PORT}.`);",
            },
          ],
        },
      },
    ],
    [{ tool: "edit", args: { path: "src/big.ts", edits: [{ oldText: editBigOld, newText: editBigNew }] } }],
    [{ text: "Edited." }],
  ],
};

test("edit results show the diff and fold large changes", { timeout: 240_000 }, async () => {
  const pi = await startPi({ scenario: edits, tune: true, cols: 100, rows: 50, settings: editSettings });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Edited.");
    const lines = rows(pi.screen());

    const first = rowIndex(lines, /^✓ edit src\/server\.ts\b/);
    assert.ok(first >= 0, `server edit header not found:\n${lines.join("\n")}`);
    assert.match(lines[first], /\+2 −2/);
    assert.ok(!lines[first].includes("ctrl+o"));

    const second = rowIndex(lines, /^✓ edit src\/big\.ts\b/, first + 1);
    assert.ok(second >= 0, `big edit header not found:\n${lines.join("\n")}`);
    assert.match(lines[second], /\+10 −10/);

    const serverDiff = lines.slice(first + 1, second);
    assert.ok(
      serverDiff.some((line) => /3 - const PORT = 3000;/.test(line)),
      `no removed server row:\n${lines.join("\n")}`,
    );
    assert.ok(
      serverDiff.some((line) => /… \d+ more lines · click to expand/.test(line)),
      `server diff did not fold:\n${lines.join("\n")}`,
    );

    const folded = lines.slice(second + 1);
    assert.equal(
      folded.filter((line) => /… \d+ more lines · click to expand/.test(line)).length,
      1,
      `folded big edit has no hint:\n${lines.join("\n")}`,
    );
    assert.ok(
      /^11 - /.test(folded.find((line) => line.trim() !== "")?.trim() ?? ""),
      `folded big edit does not start at the change:\n${lines.join("\n")}`,
    );
    assert.equal(countBodyRows(lines, second + 1), 3, `folded big edit body:\n${lines.join("\n")}`);
    assertNoExpandHint(lines, first, rowIndex(lines, /^Edited\.$/));
    await pi.shot("tools-edit");

    pi.press("ctrl+o");
    // The collapsed preview already pairs line 11; the last added line shows only once expanded.
    await pi.waitFor(/20 \+ const value20 = 200;/);
    await pi.waitForGone("click to expand");
    assert.ok(!pi.screen().join("\n").includes("click to expand"));
    await pi.shot("tools-expanded-diff");
  });
});

const writeReadme = `${Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n")}\n`;
const writeServer = `${Array.from({ length: 15 }, (_, index) => `const route${index + 1} = createRoute(${index + 1});`).join("\n")}\n`;
const writeSettings = { defaultTools: ["read", "bash", "edit", "write", "grep", "find", "ls"] };

const writes: Scenario = {
  files: { "README.md": writeReadme },
  turns: [
    [{ tool: "write", args: { path: "src/server.ts", content: writeServer } }],
    [
      {
        tool: "write",
        args: { path: "README.md", content: `${writeReadme.replace("line 4", "line four")}line 9\n` },
      },
    ],
    [{ text: "Written." }],
  ],
};

test("write tells new files from overwrites and diffs overwrites", { timeout: 240_000 }, async () => {
  const pi = await startPi({ scenario: writes, tune: true, cols: 100, rows: 50, settings: writeSettings });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Written.");
    const lines = rows(pi.screen());

    const fresh = rowIndex(lines, /^✓ write src\/server\.ts\b.*new · 15 lines/);
    assert.ok(fresh >= 0, `new file header not found:\n${lines.join("\n")}`);
    assertRowsInOrder(
      lines,
      [
        "new · 15 lines",
        "1 │ const route1 =",
        "2 │ const route2 =",
        "3 │ const route3 =",
        "… 12 more lines · click to expand",
      ],
      fresh,
    );
    assertNoExpandHint(lines, fresh, rowIndex(lines, /^Written\.$/));
    await pi.shot("tools-write-new");

    const overwrite = rowIndex(lines, /^✓ write README\.md\b.*overwrite · \+2 −1/, fresh + 1);
    assert.ok(overwrite >= 0, `overwrite header not found:\n${lines.join("\n")}`);
    const body = lines.slice(overwrite + 1);
    assert.equal(countBodyRows(lines, overwrite + 1), 3, `overwrite folded body:\n${lines.join("\n")}`);
    assert.ok(
      body.some((line) => /… \d+ more lines · click to expand/.test(line)),
      `overwrite has no hint:\n${lines.join("\n")}`,
    );
    assert.ok(
      body.slice(0, 3).some((line) => /^\d+ [-+] /.test(line.trim())),
      `overwrite preview does not start at the change:\n${lines.join("\n")}`,
    );
    await pi.shot("tools-write-overwrite");
  });
});

const railTurns: Scenario = {
  files,
  turns: [[{ tool: "read", args: { path: "README.md" } }], [{ text: "Second answer." }]],
};

test("the timeline rail leaves the tool header counts whole", { timeout: 180_000 }, async () => {
  const pi = await startPi({
    scenario: railTurns,
    tune: true,
    cols: 100,
    rows: 30,
    settings: { tuiMode: "fullscreen", fullscreenScrollbar: "hidden" },
  });
  await closeAfter(pi, async () => {
    pi.type("first turn\r");
    await pi.waitFor(/✓ read README\.md/);
    pi.type("second turn\r");
    await pi.waitFor("Second answer.");
    await pi.waitFor(/▾$/m);

    const screen = pi.screen();
    const header = screen.find((line) => line.includes("✓ read README.md")) ?? "";
    assert.match(header, /3 lines · 0\.0s/, `the rail ate the counts: ${JSON.stringify(header)}`);
  });
});

test("reference task before pi-tune", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: reference, tune: false });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Done:");
    await pi.shot("tools-before");
  });
});
