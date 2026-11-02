import assert from "node:assert/strict";
import test from "node:test";
import { type Scenario, startPi } from "./harness.ts";

const scenario: Scenario = {
  files: { "README.md": "# demo\n" },
  turns: [
    [{ thinking: "先跑一下命令。" }, { tool: "bash", args: { command: "seq 1 12" } }],
    [{ text: "完成，共输出 **12** 行。" }],
  ],
};

for (const tune of [true, false]) {
  test(`scripted model runs a tool (${tune ? "after" : "before"})`, { timeout: 180_000 }, async () => {
    const pi = await startPi({ scenario, tune });
    try {
      pi.type("跑一下\r");
      await pi.waitFor("完成，共输出");
      const screen = pi.screen().join("\n");
      assert.ok(screen.includes("$ seq 1 12"), screen);
      assert.ok(screen.includes("完成，共输出 12 行。"), screen);
      await pi.shot(tune ? "harness-after" : "harness-before");
    } finally {
      await pi.close();
    }
  });
}
