import { existsSync, readFileSync } from "node:fs";

/**
 * Which tool calls a btw thread runs, from `btw.allow` and `btw.deny` in `pi-tune.json`. A rule is a tool name
 * pattern (`read`, `mcp__docs__*`) or a bash command pattern (`bash(tinyfish *)`); `*` matches anything, and
 * deny wins over allow.
 */
export interface BtwRules {
  allow: readonly string[];
  deny: readonly string[];
}

/** What a missing `btw.allow` / `btw.deny` means. A configured list replaces its default whole. */
export const DEFAULT_RULES: BtwRules = { allow: ["read", "grep", "find", "ls"], deny: [] };

export interface BtwRulesLoad {
  rules: BtwRules;
  /** Set when the file is broken; the rules are then the defaults. */
  problem?: string;
}

export function loadBtwRules(path: string): BtwRulesLoad {
  if (!existsSync(path)) return { rules: DEFAULT_RULES };
  return parseBtwRules(readFileSync(path, "utf8"), path);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const RULE = /^([^()\s]+)(?:\((.*)\))?$/s;

function ruleProblem(rule: string): string | undefined {
  const match = RULE.exec(rule);
  if (!match) return "is not a tool name or bash(<command pattern>)";
  if (match[2] === undefined) return undefined;
  if (match[1] !== "bash") return "only bash rules take a pattern in parentheses";
  if (match[2].trim() === "") return "has an empty command pattern";
  return undefined;
}

export function parseBtwRules(raw: string, path: string): BtwRulesLoad {
  const broken = (detail: string): BtwRulesLoad => ({
    rules: DEFAULT_RULES,
    problem: `btw tools use the defaults: ${path} ${detail}.`,
  });
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return broken(`is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isRecord(value)) return broken("must contain a JSON object");
  if (!("btw" in value)) return { rules: DEFAULT_RULES };
  const btw = value.btw;
  if (!isRecord(btw)) return broken('has a "btw" value that is not an object');

  const lists: Partial<Record<keyof BtwRules, string[]>> = {};
  for (const key of ["allow", "deny"] as const) {
    if (!(key in btw)) continue;
    const list = btw[key];
    if (!Array.isArray(list) || list.some((rule) => typeof rule !== "string")) {
      return broken(`has a "btw.${key}" value that is not a list of strings`);
    }
    for (const [index, rule] of (list as string[]).entries()) {
      const problem = ruleProblem(rule);
      if (problem) return broken(`has "btw.${key}[${index}]" ${rule}: ${problem}`);
    }
    lists[key] = list as string[];
  }
  return { rules: { allow: lists.allow ?? DEFAULT_RULES.allow, deny: lists.deny ?? DEFAULT_RULES.deny } };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `*` matches anything; a trailing ` *` also matches the bare command, so `git log *` covers `git log`. */
function globMatches(glob: string, text: string): boolean {
  if (glob.endsWith(" *") && globMatches(glob.slice(0, -2), text)) return true;
  return new RegExp(`^${glob.split("*").map(escapeRegExp).join(".*")}$`, "s").test(text);
}

function parseRule(rule: string): { name: string; command?: string } {
  const match = RULE.exec(rule);
  return match?.[2] === undefined ? { name: rule } : { name: match[1], command: match[2] };
}

/**
 * The commands of a shell line, split on `|`, `&&`, `||`, `;`, `&` and new lines outside quotes. Command
 * substitution, process substitution, here-documents and writing redirections make it uncheckable.
 */
export function splitCommand(command: string): { segments: string[] } | { problem: string } {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | undefined;
  const flush = () => {
    if (current.trim() !== "") segments.push(current.trim());
    current = "";
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    const next = command[index + 1];
    if (quote === "'") {
      if (char === "'") quote = undefined;
      current += char;
      continue;
    }
    if (char === "\\") {
      current += char + (next ?? "");
      index++;
      continue;
    }
    if (char === "`" || (char === "$" && next === "(")) return { problem: "command substitution" };
    if (quote === '"') {
      if (char === '"') quote = undefined;
      current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "<") {
      if (next === "(") return { problem: "process substitution" };
      if (next === "<") return { problem: "a here-document" };
      current += char;
      continue;
    }
    if (char === ">" || (char === "&" && next === ">")) {
      // `>`, `>>`, `>|`, `&>`, `&>>` need `/dev/null` as their target; `>&` a standard descriptor.
      const operator = /^(?:&>>?|>>|>\||>&|>)/.exec(command.slice(index))?.[0] ?? ">";
      let end = index + operator.length;
      if (operator !== ">&") while (command[end] === " ") end++;
      const target = /^[^\s;|&<>]*/.exec(command.slice(end))?.[0] ?? "";
      const harmless = operator === ">&" ? /^[12]$/.test(target) : target === "/dev/null";
      if (!harmless) return { problem: "a redirection that writes a file" };
      current += command.slice(index, end + target.length);
      index = end + target.length - 1;
      continue;
    }
    if (char === "\n" || char === ";") {
      flush();
      continue;
    }
    if (char === "|" || char === "&") {
      flush();
      if (next === char) index++;
      if (char === "|" && next === "&") index++;
      continue;
    }
    current += char;
  }
  flush();
  return { segments };
}

/** Why a call was refused: no allow rule names it, a deny rule names it, or the command cannot be checked. */
export type Refusal = "not-allowed" | "denied" | "unchecked";

export type Verdict =
  | { allowed: true }
  | {
      allowed: false;
      refusal: Refusal;
      /** The rule that names the call, ready to copy into the settings: `codemode`, `bash(date *)`. */
      rule: string;
      /** What the usage row shows. */
      label: string;
      /** For `unchecked`: the construct that cannot be checked. */
      detail?: string;
    };

const UNCHECKED_MARK: Record<string, string> = {
  "command substitution": "$(…)",
  "process substitution": "<(…)",
  "a here-document": "<<",
  "a redirection that writes a file": ">",
};

/** `bash(date *)` for `date +%F`: the rule that allows the command's program. */
function commandRule(segment: string): string {
  return `bash(${segment.trim().split(/\s+/)[0] ?? ""} *)`;
}

/** Whether a btw thread runs this call. */
export function judge(tool: string, args: unknown, rules: BtwRules): Verdict {
  const allow = rules.allow.map(parseRule);
  const deny = rules.deny.map(parseRule);
  const byName = (list: typeof allow) =>
    list.some((rule) => rule.command === undefined && globMatches(rule.name, tool));
  const refuse = (refusal: Refusal, rule: string, label = rule, detail?: string): Verdict => ({
    allowed: false,
    refusal,
    rule,
    label,
    ...(detail === undefined ? {} : { detail }),
  });

  if (tool !== "bash") {
    if (byName(deny)) return refuse("denied", tool);
    if (!byName(allow)) return refuse("not-allowed", tool);
    return { allowed: true };
  }

  const command =
    typeof (args as { command?: unknown })?.command === "string" ? (args as { command: string }).command : "";
  const patterns = (list: typeof allow) =>
    list.flatMap((rule) => (rule.name === "bash" && rule.command !== undefined ? [rule.command] : []));
  if (byName(deny)) return refuse("denied", "bash");
  const wholesale = byName(allow);
  const denied = patterns(deny);
  if (wholesale && denied.length === 0) return { allowed: true };

  const split = splitCommand(command);
  if ("problem" in split) {
    const rule = commandRule(command);
    return refuse("unchecked", rule, `${rule.slice(0, -3)} ${UNCHECKED_MARK[split.problem] ?? "…"})`, split.problem);
  }
  const allowed = patterns(allow);
  for (const segment of split.segments) {
    if (denied.some((pattern) => globMatches(pattern, segment))) return refuse("denied", commandRule(segment));
    if (!wholesale && !allowed.some((pattern) => globMatches(pattern, segment))) {
      return refuse("not-allowed", commandRule(segment));
    }
  }
  return { allowed: true };
}
