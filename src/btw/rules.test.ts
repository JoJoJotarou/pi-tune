import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowedCalls, DEFAULT_RULES, judge, parseBtwRules, splitCommand } from "./rules.ts";

const PATH = "/agent/pi-tune.json";

function rules(allow: string[], deny: string[] = []) {
  return { allow, deny };
}

describe("parseBtwRules", () => {
  it("uses the default allow list when the file has no btw rules", () => {
    assert.deepEqual(parseBtwRules({}, PATH), { rules: DEFAULT_RULES });
    assert.deepEqual(parseBtwRules({ suggest: { enabled: true } }, PATH), { rules: DEFAULT_RULES });
    assert.deepEqual(DEFAULT_RULES, { allow: ["read", "grep", "find", "ls"], deny: [] });
  });

  it("takes a configured allow list as it is, without the defaults", () => {
    const load = parseBtwRules({ btw: { allow: ["grep", "bash(tinyfish *)"], deny: ["bash(rm *)"] } }, PATH);
    assert.deepEqual(load, { rules: { allow: ["grep", "bash(tinyfish *)"], deny: ["bash(rm *)"] } });
  });

  it("names the file and the field of a broken setting, and falls back to the defaults", () => {
    const cases: [string, RegExp][] = [
      ['{"btw":1}', /"btw" value that is not an object/],
      ['{"btw":{"allow":"read"}}', /"btw\.allow" value that is not a list of strings/],
      ['{"btw":{"deny":["ok",2]}}', /"btw\.deny" value that is not a list of strings/],
      ['{"btw":{"allow":["read(src/*)"]}}', /"btw\.allow\[0\]" read\(src\/\*\): only bash rules take a pattern/],
      ['{"btw":{"deny":["bash()"]}}', /"btw\.deny\[0\]" bash\(\)/],
    ];
    for (const [raw, problem] of cases) {
      const load = parseBtwRules(JSON.parse(raw), PATH);
      assert.deepEqual(load.rules, DEFAULT_RULES, raw);
      assert.match(load.problem ?? "", problem, raw);
      assert.ok(load.problem?.includes(PATH), raw);
    }
  });
});

describe("splitCommand", () => {
  it("splits on every shell separator outside quotes", () => {
    assert.deepEqual(splitCommand("a | b && c || d; e\nf & g"), { segments: ["a", "b", "c", "d", "e", "f", "g"] });
    assert.deepEqual(splitCommand(`echo "a | b" 'c && d'`), { segments: [`echo "a | b" 'c && d'`] });
  });

  it("refuses what it cannot check", () => {
    for (const command of ["echo $(rm x)", "echo `rm x`", 'echo "$(rm x)"', "cat <(rm x)", "cat <<EOF", "echo x > f"]) {
      assert.ok("problem" in splitCommand(command), command);
    }
  });

  it("keeps harmless redirections and input files", () => {
    for (const command of [
      "a 2>&1",
      "a >/dev/null",
      "a 2> /dev/null",
      "a &>/dev/null",
      "wc -l < notes.md",
      "echo '$(x)'",
    ]) {
      assert.ok("segments" in splitCommand(command), command);
    }
  });
});

describe("judge", () => {
  it("allows tools by name pattern and lets deny win", () => {
    assert.deepEqual(judge("read", { path: "a" }, DEFAULT_RULES), { allowed: true });
    assert.equal(judge("write", { path: "a" }, DEFAULT_RULES).allowed, false);
    assert.equal(judge("mcp__docs__search", {}, rules(["mcp__docs__*"])).allowed, true);
    assert.equal(judge("mcp__docs__delete", {}, rules(["mcp__docs__*"], ["mcp__docs__delete*"])).allowed, false);
    assert.equal(judge("read", { path: "a" }, rules(["grep"])).allowed, false, "the defaults are only defaults");
  });

  it("matches bash rules against every command of a compound command", () => {
    const tinyfish = rules(["bash(tinyfish *)", "bash(head *)"]);
    assert.equal(judge("bash", { command: "tinyfish search query x" }, tinyfish).allowed, true);
    assert.equal(
      judge("bash", { command: "tinyfish" }, tinyfish).allowed,
      true,
      "a trailing ` *` also matches no arguments",
    );
    assert.equal(judge("bash", { command: "tinyfish search x 2>&1 | head -5" }, tinyfish).allowed, true);
    assert.equal(judge("bash", { command: "tinyfishy" }, tinyfish).allowed, false);
    assert.equal(judge("bash", { command: "tinyfish x; rm a" }, tinyfish).allowed, false);
    assert.equal(judge("bash", { command: "tinyfish $(cat a)" }, tinyfish).allowed, false);
    assert.equal(judge("bash", { command: "tinyfish x > f" }, tinyfish).allowed, false);
  });

  it("allows every command for a plain bash rule unless a deny pattern matches", () => {
    assert.equal(judge("bash", { command: "echo $(date) > f" }, rules(["bash"])).allowed, true);
    assert.equal(judge("bash", { command: "ls; rm -rf x" }, rules(["bash"], ["bash(rm *)"])).allowed, false);
    assert.equal(judge("bash", { command: "ls $(x)" }, rules(["bash"], ["bash(rm *)"])).allowed, false);
    assert.equal(judge("bash", { command: "ls" }, rules(["bash"], ["bash"])).allowed, false);
  });

  it("names a refused call by the rule that would allow it", () => {
    assert.deepEqual(judge("write", { path: "a" }, DEFAULT_RULES), {
      allowed: false,
      refusal: "not-allowed",
      rule: "write",
      label: "write",
    });
    const date = judge("bash", { command: 'date "+%Y-%m-%d %A"' }, DEFAULT_RULES);
    assert.deepEqual(date, { allowed: false, refusal: "not-allowed", rule: "bash(date *)", label: "bash(date *)" });
    const second = judge("bash", { command: "ls -la | wc -l" }, rules(["bash(ls *)"]));
    assert.equal(second.allowed === false && second.rule, "bash(wc *)", "the segment that failed names the rule");
  });

  it("keeps the subcommand in a suggested rule, so copying it does not open the program's other subcommands", () => {
    const rule = (command: string) => {
      const verdict = judge("bash", { command }, DEFAULT_RULES);
      return verdict.allowed ? "allowed" : verdict.rule;
    };
    assert.equal(rule("git log --oneline -5"), "bash(git log *)");
    assert.equal(rule("gh pr view 12"), "bash(gh pr view *)");
    assert.equal(rule("tinyfish search query 'pi'"), "bash(tinyfish search query *)");
    assert.equal(rule("cat README.md"), "bash(cat *)");
    assert.equal(rule("rg TODO src"), "bash(rg *)");
    const copied = (refused: string, other: string) =>
      judge("bash", { command: other }, rules([rule(refused)])).allowed;
    assert.equal(copied("git log --oneline", "git log -5"), true, "the copied rule allows the refused command's kind");
    assert.equal(copied("git log --oneline", "git push origin main"), false);
    assert.equal(copied("gh pr view 12", "gh pr merge 12"), false);
    const denied = judge("bash", { command: "rm x" }, rules(["bash"], ["bash(rm *)"]));
    assert.equal(denied.allowed === false && denied.refusal, "denied");
    const unchecked = judge("bash", { command: "ls $(x)" }, rules(["bash(ls *)"]));
    assert.deepEqual(unchecked, {
      allowed: false,
      refusal: "unchecked",
      rule: "bash(ls *)",
      label: "bash(ls $(…))",
      detail: "command substitution",
    });
  });
});

describe("allowedCalls", () => {
  it("lists the built-in calls the rules allow, written as rules", () => {
    assert.deepEqual(allowedCalls(DEFAULT_RULES), ["read", "grep", "find", "ls"]);
    assert.deepEqual(allowedCalls(rules(["read", "bash(tinyfish *)", "bash(git log *)", "mcp__docs__*"])), [
      "read",
      "bash(tinyfish *)",
      "bash(git log *)",
    ]);
    assert.deepEqual(allowedCalls(rules(["*"], ["edit", "write"])), ["read", "grep", "find", "ls", "bash"]);
    assert.deepEqual(allowedCalls(rules(["bash"], ["bash"])), []);
  });
});
