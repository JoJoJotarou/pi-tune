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
