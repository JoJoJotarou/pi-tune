import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_RULES, judge, parseBtwRules, splitCommand } from "./rules.ts";

const PATH = "/agent/pi-tune.json";

function rules(allow: string[], deny: string[] = []) {
  return { allow, deny };
}

describe("parseBtwRules", () => {
  it("uses the default allow list when the file has no btw rules", () => {
    assert.deepEqual(parseBtwRules("{}", PATH), { rules: DEFAULT_RULES });
    assert.deepEqual(parseBtwRules('{"suggest":{"enabled":true}}', PATH), { rules: DEFAULT_RULES });
    assert.deepEqual(DEFAULT_RULES, { allow: ["read", "grep", "find", "ls"], deny: [] });
  });

  it("takes a configured allow list as it is, without the defaults", () => {
    const load = parseBtwRules('{"btw":{"allow":["grep","bash(tinyfish *)"],"deny":["bash(rm *)"]}}', PATH);
    assert.deepEqual(load, { rules: { allow: ["grep", "bash(tinyfish *)"], deny: ["bash(rm *)"] } });
  });

  it("names the file and the field of a broken setting, and falls back to the defaults", () => {
    const cases: [string, RegExp][] = [
      ["{", /pi-tune\.json is not valid JSON/],
      ["[]", /must contain a JSON object/],
      ['{"btw":1}', /"btw" value that is not an object/],
      ['{"btw":{"allow":"read"}}', /"btw\.allow" value that is not a list of strings/],
      ['{"btw":{"deny":["ok",2]}}', /"btw\.deny" value that is not a list of strings/],
      ['{"btw":{"allow":["read(src/*)"]}}', /"btw\.allow\[0\]" read\(src\/\*\): only bash rules take a pattern/],
      ['{"btw":{"deny":["bash()"]}}', /"btw\.deny\[0\]" bash\(\)/],
    ];
    for (const [raw, problem] of cases) {
      const load = parseBtwRules(raw, PATH);
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

  it("labels a denied call the way a rule would name it, with the reason", () => {
    const write = judge("write", { path: "a" }, DEFAULT_RULES);
    assert.deepEqual(write, { allowed: false, label: "write", reason: 'is not in "btw.allow"' });
    const bash = judge("bash", { command: "rm -rf\nbuild" }, rules(["bash(ls *)"]));
    assert.deepEqual(bash, { allowed: false, label: "bash(rm -rf build)", reason: 'is not in "btw.allow"' });
    const denied = judge("bash", { command: "rm x" }, rules(["bash"], ["bash(rm *)"]));
    assert.equal(denied.allowed === false && denied.reason, 'matches "btw.deny"');
    const unchecked = judge("bash", { command: "ls $(x)" }, rules(["bash(ls *)"]));
    assert.equal(unchecked.allowed === false && unchecked.reason, "uses command substitution, which btw cannot check");
  });
});
