import { readFileSync } from "node:fs";
import type { FauxContentBlock, ToolCall } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Block, Scenario } from "./harness.ts";

function loadScenario(): Scenario {
  const path = process.env.PI_TUNE_SCENARIO;
  if (!path) throw new Error("PI_TUNE_SCENARIO is not set");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read scenario ${path}: ${(error as Error).message}`);
  }
  const scenario = parsed as Partial<Scenario> | null;
  if (!scenario || !Array.isArray(scenario.turns)) {
    throw new Error(`Scenario ${path} has no turns array`);
  }
  return scenario as Scenario;
}

function toContent(turn: Block[]): FauxContentBlock[] {
  return turn.map((block) => {
    if ("thinking" in block) return fauxThinking(block.thinking);
    if ("text" in block) return fauxText(block.text);
    if ("tool" in block) return fauxToolCall(block.tool, (block.args ?? {}) as ToolCall["arguments"]);
    throw new Error(`Unknown scenario block: ${JSON.stringify(block)}`);
  });
}

export default function (pi: ExtensionAPI) {
  const scenario = loadScenario();
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "scripted", reasoning: true }],
    tokensPerSecond: scenario.tokensPerSecond ?? 2000,
  });
  faux.setResponses(
    scenario.turns.map((turn) => {
      const message = fauxAssistantMessage(
        toContent(turn),
        turn.some((block) => "tool" in block) ? { stopReason: "toolUse" } : undefined,
      );
      return scenario.durationMs === undefined ? message : { ...message, durationMs: scenario.durationMs };
    }),
  );
  pi.registerProvider(faux.provider);
}
