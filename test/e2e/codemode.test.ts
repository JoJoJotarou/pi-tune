import assert from "node:assert/strict";
import test from "node:test";
import { type PiSession, type Scenario, startPi } from "./harness.ts";

const settings = { defaultTools: ["+codemode"] };

const parallel: Scenario = {
  files: { "README.md": "# demo\n\nA tiny project.\n" },
  turns: [
    [
      {
        tool: "codemode",
        args: {
          code: [
            '// @options: {"max_output_tokens": 2000}',
            "const [readme, output] = await Promise.all([",
            '  tools.read({ path: "README.md" }),',
            '  tools.bash({ command: "seq 1 3" }),',
            "]);",
            "text(readme);",
            "text(output.output);",
          ].join("\n"),
        },
      },
    ],
    [{ text: "Script done." }],
  ],
};

const failing: Scenario = {
  files: { "README.md": "# demo\n\nA tiny project.\n" },
  turns: [
    [
      {
        tool: "codemode",
        args: {
          code: ['text("before");', 'await tools.bash({ command: "seq 1 3" });', 'throw new Error("boom");'].join("\n"),
        },
      },
    ],
    [{ text: "Script failed." }],
  ],
};

function rows(screen: string[]): string[] {
  return screen.map((row) => row.trim());
}

function rowIndex(lines: string[], matcher: string | RegExp, from = 0): number {
  for (let index = from; index < lines.length; index++) {
    if (typeof matcher === "string" ? lines[index].includes(matcher) : matcher.test(lines[index])) return index;
  }
  return -1;
}

async function closeAfter(pi: PiSession, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } finally {
    await pi.close();
  }
}

test("a codemode script shows its header until expanded", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: parallel, tune: true, codemode: true, settings });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Script done.");
    const collapsed = rows(pi.screen());

    const header = rowIndex(collapsed, /^✓ codemode read, bash\s+2 calls · /);
    assert.ok(header >= 0, `codemode header not found:\n${collapsed.join("\n")}`);
    for (const line of collapsed)
      assert.ok(!line.includes("const [readme"), `script is visible:\n${collapsed.join("\n")}`);
    assert.ok(
      !collapsed.some((line) => line.includes('"path":"README.md"')),
      `inner calls are visible:\n${collapsed.join("\n")}`,
    );
    assert.ok(!collapsed.some((line) => line.includes("Script completed")), collapsed.join("\n"));
    await pi.shot("codemode-collapsed");

    pi.press("ctrl+o");
    await pi.waitFor('tools.read({ path: "README.md" })');
    const expanded = rows(pi.screen());
    const script = rowIndex(expanded, /^\/\/ @options:/);
    assert.ok(script >= 0, `options line not found:\n${expanded.join("\n")}`);
    assert.ok(rowIndex(expanded, /^tools\.read\(\{ path: "README\.md" \}\),/, script + 1) >= 0, expanded.join("\n"));

    const call = rowIndex(expanded, /^✓ read \{"path":"README\.md"\} \d+ms$/, script + 1);
    assert.ok(call >= 0, `inner call row not found:\n${expanded.join("\n")}`);
    assert.ok(rowIndex(expanded, /^✓ bash \{"command":"seq 1 3"\} \d+ms$/, call + 1) >= 0, expanded.join("\n"));
    assert.ok(rowIndex(expanded, /^# demo$/, call + 1) >= 0, `output not found:\n${expanded.join("\n")}`);
    assert.ok(!expanded.some((line) => line.includes("Script completed")), expanded.join("\n"));
    assert.ok(!expanded.some((line) => line.includes("Wall time")), expanded.join("\n"));
    await pi.shot("codemode-expanded");
  });
});

test("a failed codemode script shows the tail of its error", { timeout: 180_000 }, async () => {
  const pi = await startPi({ scenario: failing, tune: true, codemode: true, settings });
  await closeAfter(pi, async () => {
    pi.type("run it\r");
    await pi.waitFor("Script failed.");
    const lines = rows(pi.screen());

    const header = rowIndex(lines, /^✗ codemode bash\b.*1 call · /);
    assert.ok(header >= 0, `failure header not found:\n${lines.join("\n")}`);
    assert.ok(rowIndex(lines, /^at <anonymous>/, header + 1) >= 0, lines.join("\n"));
    assert.ok(rowIndex(lines, /^Tool calls made before the failure/, header + 1) >= 0, lines.join("\n"));
    assert.ok(rowIndex(lines, /^… \d+ more lines · click to expand$/, header + 1) >= 0, lines.join("\n"));
    await pi.shot("codemode-failed");
  });
});
