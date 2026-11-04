import { spawnSync } from "node:child_process";

/** macOS Seatbelt (`sandbox-exec`) or Linux bubblewrap (`bwrap`). */
export type SandboxKind = "seatbelt" | "bwrap";

/** Everything is allowed except writing files, outside the temp directories and the terminal devices. */
const SEATBELT_PROFILE = [
  "(version 1)",
  "(allow default)",
  "(deny file-write*)",
  '(allow file-write* (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/fd/") (subpath "/private/tmp") (subpath "/private/var/folders"))',
].join("");

function quote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/** The command that runs `command` read-only: no file writes outside temp directories, network as usual. */
export function sandboxCommand(kind: SandboxKind, command: string): string {
  if (kind === "seatbelt") return `sandbox-exec -p ${quote(SEATBELT_PROFILE)} /bin/bash -c ${quote(command)}`;
  return `bwrap --ro-bind / / --dev /dev --proc /proc --bind /tmp /tmp --die-with-parent /bin/bash -c ${quote(command)}`;
}

/**
 * The sandbox this machine can run, or why there is none. It runs a no-op through the sandbox, so a
 * missing or blocked `bwrap` (some distributions forbid the user namespaces it needs) counts as none.
 */
export function detectSandbox(platform: NodeJS.Platform = process.platform): SandboxKind | Error {
  const kind: SandboxKind | undefined = platform === "darwin" ? "seatbelt" : platform === "linux" ? "bwrap" : undefined;
  if (kind === undefined) return new Error(`pi-tune has no read-only sandbox for ${platform}`);
  const tool = kind === "seatbelt" ? "sandbox-exec" : "bwrap";
  const probe = spawnSync("/bin/sh", ["-c", sandboxCommand(kind, "true")], { encoding: "utf8", timeout: 5000 });
  if (probe.error) return new Error(`${tool} did not run: ${probe.error.message}`);
  if (probe.status !== 0) {
    const detail = probe.stderr.trim().split("\n")[0] || `exit code ${probe.status}`;
    return new Error(`${tool} did not run: ${detail}`);
  }
  return kind;
}
