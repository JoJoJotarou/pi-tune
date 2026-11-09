import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGitStatus, probeGitState, type RunGit, sumNumstat } from "./git.ts";

const signal = new AbortController().signal;

/** A git that answers each subcommand by its first argument and records what was asked. */
function fakeGit(answers: Record<string, string | undefined>): { run: RunGit; calls: string[][] } {
  const calls: string[][] = [];
  const run: RunGit = async (args) => {
    calls.push([...args]);
    return answers[args[0] ?? ""];
  };
  return { run, calls };
}

test("git status gives the branch counts and only counts tracked changes", () => {
  const status = [
    "# branch.oid 1a2b3c",
    "# branch.head feat/footer-glyphs",
    "# branch.upstream origin/feat/footer-glyphs",
    "# branch.ab +2 -1",
    "1 .M N... 100644 100644 100644 aaa bbb src/chrome/footer.ts",
    "2 R. N... 100644 100644 100644 aaa bbb src/renamed.ts",
    "src/original.ts",
    "u UU N... 100644 100644 100644 100644 aaa bbb ccc conflicted.ts",
    "? notes.txt",
    "",
  ].join("\0");
  assert.deepEqual(parseGitStatus(status), { ahead: 2, behind: 1, changed: 3 });
});

test("git status without an upstream reports no branch counts", () => {
  const status = ["# branch.head main", "1 .M N... 100644 100644 100644 aaa bbb a.ts", ""].join("\0");
  assert.deepEqual(parseGitStatus(status), { ahead: 0, behind: 0, changed: 1 });
  assert.deepEqual(parseGitStatus(""), { ahead: 0, behind: 0, changed: 0 });
});

test("numstat sums the line counts and skips binary files", () => {
  assert.deepEqual(sumNumstat("12\t3\tsrc/a.ts\n4\t0\tsrc/b.ts\n"), { added: 16, deleted: 3 });
  assert.deepEqual(sumNumstat("-\t-\tlogo.png\n7\t7\tsrc/c.ts\n"), { added: 7, deleted: 7 });
  assert.deepEqual(sumNumstat("garbage\n\n"), { added: 0, deleted: 0 });
});

test("a clean tree costs one git call: there is nothing to diff", async () => {
  const { run, calls } = fakeGit({ status: ["# branch.ab +0 -0", ""].join("\0") });
  assert.deepEqual(await probeGitState(run, signal), { ahead: 0, behind: 0, added: 0, deleted: 0 });
  assert.deepEqual(calls, [["status", "--porcelain=v2", "--branch", "-z"]]);
});

test("a changed tree adds the index and worktree diffs together", async () => {
  const { run, calls } = fakeGit({
    status: ["# branch.ab +2 -1", "1 .M N... 100644 100644 100644 aaa bbb a.ts", ""].join("\0"),
    diff: "5\t1\ta.ts\n",
  });
  assert.deepEqual(await probeGitState(run, signal), { ahead: 2, behind: 1, added: 10, deleted: 2 });
  assert.deepEqual(
    calls.map((args) => args.join(" ")),
    ["status --porcelain=v2 --branch -z", "diff --numstat", "diff --cached --numstat"],
  );
});

test("outside a repository, or with git missing, there is no reading", async () => {
  assert.equal(await probeGitState(fakeGit({}).run, signal), undefined);

  const { run } = fakeGit({
    status: ["1 .M N... 100644 100644 100644 aaa bbb a.ts", ""].join("\0"),
    diff: undefined,
  });
  assert.equal(await probeGitState(run, signal), undefined);
});
