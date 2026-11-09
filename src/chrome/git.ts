import { spawn } from "node:child_process";

/** What the footer draws after the branch. Zero counts stay off the row. */
export interface GitState {
  /** Commits HEAD has that the upstream does not: a push sends these. */
  ahead: number;
  /** Commits the upstream has that HEAD does not: a pull brings these in. */
  behind: number;
  /** Lines the index and the working tree add over HEAD. */
  added: number;
  /** Lines the index and the working tree remove from HEAD. */
  deleted: number;
}

/** Runs one git command and returns its stdout, or `undefined` when git fails, times out or is missing. */
export type RunGit = (args: readonly string[], signal: AbortSignal) => Promise<string | undefined>;

/** `git status --porcelain=v2 --branch -z`: the header's ahead/behind, and how many entries are tracked changes. */
export function parseGitStatus(stdout: string): { ahead: number; behind: number; changed: number } {
  let ahead = 0;
  let behind = 0;
  let changed = 0;
  // `-z` separates records with NUL so a path with a newline or a quote stays one field; a rename's original
  // path arrives as its own NUL field and starts with neither digit, so it is not counted.
  for (const record of stdout.split("\0")) {
    if (record.startsWith("# branch.ab ")) {
      const counts = /\+(\d+) -(\d+)/.exec(record);
      if (counts) {
        ahead = Number(counts[1]);
        behind = Number(counts[2]);
      }
    } else if (record.startsWith("1 ") || record.startsWith("2 ") || record.startsWith("u ")) {
      changed += 1;
    }
  }
  return { ahead, behind, changed };
}

/** `git diff --numstat`: `12<TAB>3<TAB>path` per file, or `-<TAB>-<TAB>path` for a binary one. */
export function sumNumstat(stdout: string): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const line of stdout.split("\n")) {
    const [addedField, deletedField] = line.split("\t");
    if (addedField === undefined || deletedField === undefined) continue;
    const fileAdded = Number(addedField);
    const fileDeleted = Number(deletedField);
    if (!Number.isInteger(fileAdded) || !Number.isInteger(fileDeleted)) continue;
    added += fileAdded;
    deleted += fileDeleted;
  }
  return { added, deleted };
}

/**
 * One `git status` for the branch counts, then the two `git diff --numstat` calls only when a tracked file changed:
 * a clean tree has nothing to diff, and `status` alone already costs a `stat()` per file.
 */
export async function probeGitState(run: RunGit, signal: AbortSignal): Promise<GitState | undefined> {
  const status = await run(["status", "--porcelain=v2", "--branch", "-z"], signal);
  if (status === undefined) return undefined;
  const { ahead, behind, changed } = parseGitStatus(status);
  if (changed === 0) return { ahead, behind, added: 0, deleted: 0 };
  const [worktree, index] = await Promise.all([
    run(["diff", "--numstat"], signal),
    run(["diff", "--cached", "--numstat"], signal),
  ]);
  if (worktree === undefined || index === undefined) return undefined;
  const unstaged = sumNumstat(worktree);
  const staged = sumNumstat(index);
  return { ahead, behind, added: unstaged.added + staged.added, deleted: unstaged.deleted + staged.deleted };
}

/** Two seconds: long enough for a hot repository, short enough that a stalled probe never blocks the next one. */
const TIMEOUT_MS = 2000;

export function gitRunner(cwd: string): RunGit {
  return (args, signal) =>
    new Promise((resolve) => {
      const child = spawn("git", [...args], {
        cwd,
        // Reading the repository must never take the index lock away from a git command the user is running.
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
        signal,
      });
      let stdout = "";
      let settled = false;
      const finish = (value: string | undefined): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.kill();
        resolve(value);
      };
      const timer = setTimeout(() => finish(undefined), TIMEOUT_MS);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      // A missing binary, a directory outside a repository and an abort are all "no reading", not a failure to
      // report: the row omits the segment and the next render asks again.
      child.on("error", () => finish(undefined));
      child.on("close", (code) => finish(code === 0 ? stdout : undefined));
    });
}
