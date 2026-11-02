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
      { tool: "bash", args: { command: "sleep 1; seq 1 40" } },
      { tool: "read", args: { path: "README.md" } },
    ],
    [{ text: "Done: printed 40 lines and read the README." }],
  ],
};

const failure: Scenario = {
  files,
  turns: [[{ tool: "bash", args: { command: "sh -c 'seq 1 20; exit 3'" } }], [{ text: "It failed." }]],
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

function assertRow(lines: string[], matcher: string | RegExp, label: string): void {
  assert.ok(rowIndex(lines, matcher) >= 0, `${label} not found:\n${lines.join("\n")}`);
}

function assertRowsInOrder(lines: string[], matchers: (string | RegExp)[], from = 0): void {
  let index = from;
  for (const matcher of matchers) {
    const found = rowIndex(lines, matcher, index);
    assert.ok(found >= index, `expected ${String(matcher)} after row ${index}:\n${lines.join("\n")}`);
    index = found + 1;
  }
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

    const bash = /^✓ bash sleep 1; seq 1 40/;
    const read = /^✓ read README\.md/;
    assert.equal(countRows(lines, bash), 1, lines.join("\n"));
    assert.equal(countRows(lines, read), 1, lines.join("\n"));

    const first = Math.min(rowIndex(lines, bash), rowIndex(lines, read));
    const last = Math.max(rowIndex(lines, bash), rowIndex(lines, read));
    assert.ok(last - first + 1 <= 4, `tool rows span ${last - first + 1} rows:\n${lines.join("\n")}`);

    for (let line = 1; line <= 40; line++) {
      assert.ok(!lines.includes(String(line)), `output line ${line} is visible:\n${lines.join("\n")}`);
    }

    await pi.shot("tools-after");
    pi.press("ctrl+o");
    await pi.waitFor(/^\s*40\s*$/m);
    await pi.shot("tools-expanded");
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

test("failed bash call folds its output", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: failure, tune: true });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("It failed.");
    const lines = rows(pi.screen());

    const header = rowIndex(lines, /^✗ bash\b.*exit 3/);
    assert.ok(header >= 0, `failure header not found:\n${lines.join("\n")}`);

    assertRowsInOrder(lines, ["│ 1", "│ 2", "lines folded", "│ 18", "│ 19", "│ 20"], header + 1);
    await pi.shot("tools-failure");
  });
});

test("heredoc command is summarised on one row", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: heredoc, tune: true });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Wrote notes.");
    const lines = rows(pi.screen());

    assertRow(lines, "cat > notes.txt <<'EOF' +21 lines", "heredoc header");
    assert.ok(!lines.includes("line 5"), `heredoc line 5 is visible:\n${lines.join("\n")}`);
    await pi.shot("tools-heredoc");
  });
});

test("narrow terminal keeps the compact header and does not crash", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: reference, tune: true, cols: 40, rows: 30 });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Done:");
    const crashLog = join(dirname(pi.projectDir), "agent", "pi-tui-crash.log");
    assert.ok(!existsSync(crashLog), `Pi crashed at 40 columns: ${crashLog}`);
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
    await pi.shot("tools-summaries");

    pi.press("ctrl+o");
    await pi.waitFor(/^\s+a\.ts\s+3 matches\s+1, 2, 3$/m);
    const expanded = rows(pi.screen());
    assert.equal(countRows(expanded, /^a\.ts\s+3 matches\b/), 1, expanded.join("\n"));
    assert.equal(countRows(expanded, /^b\.ts\s+1 match\b/), 1, expanded.join("\n"));
    await pi.shot("tools-grep-expanded");
  });
});

test("summary task before pi-tune", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: summaries, tune: false, cols: 100, rows: 40, settings: summarySettings });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Summary done.");
    await pi.shot("tools-summaries-before");
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

test("edit results show diffs and fold large changes", { timeout: 240_000 }, async () => {
  const pi = await startPi({ scenario: edits, tune: true, cols: 100, rows: 50, settings: editSettings });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Edited.");
    const lines = rows(pi.screen());

    const first = rowIndex(lines, /^✓ edit src\/server\.ts\b/);
    assert.ok(first >= 0, `server edit header not found:\n${lines.join("\n")}`);
    assert.match(lines[first], /\+2 −2/);

    const second = rowIndex(lines, /^✓ edit src\/big\.ts\b/, first + 1);
    assert.ok(second >= 0, `big edit header not found:\n${lines.join("\n")}`);
    assert.match(lines[second], /· ctrl\+o/);

    const serverDiff = lines.slice(first + 1, second);
    assert.ok(
      serverDiff.some((line) => line.includes("│-const PORT = 3000;")),
      `no removed server row:\n${lines.join("\n")}`,
    );
    assert.ok(
      serverDiff.some((line) => line.includes("│+const PORT = Number")),
      `no added server row:\n${lines.join("\n")}`,
    );

    const folded = lines.slice(second + 1);
    assert.ok(
      !folded.some((line) => line.includes("│-") || line.includes("│+")),
      `folded big edit rendered diff rows:\n${lines.join("\n")}`,
    );
    await pi.shot("edit-diff");

    pi.press("ctrl+o");
    await pi.waitFor(/│-const value11 = 11;/);
    await pi.shot("edit-diff-expanded");
  });

  const before = await startPi({ scenario: edits, tune: false, cols: 100, rows: 50, settings: editSettings });
  await closeAfter(before, async () => {
    before.type("run it\r");
    await before.waitFor("Edited.");
    await before.shot("edit-diff-before");
  });

  const light = await startPi({
    scenario: edits,
    tune: true,
    cols: 100,
    rows: 50,
    settings: { ...editSettings, theme: "light" },
  });
  await closeAfter(light, async () => {
    light.type("run it\r");
    await light.waitFor("Edited.");
    await light.shot("edit-diff-light");
  });
});
