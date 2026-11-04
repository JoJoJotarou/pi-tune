import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Message, Model } from "@earendil-works/pi-ai";
import type {
  AgentSession,
  ExtensionAPI,
  ExtensionContext,
  ResourceLoader,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { stripDynamicSystemPromptFooter } from "./prompt.ts";

/**
 * A tool that serializes exactly like the parent's but never runs: the declarations are only there
 * to keep the request prefix byte-identical, and a side thread answers in plain text.
 */
function stubTool(info: ReturnType<ExtensionAPI["getAllTools"]>[number]): ToolDefinition {
  return {
    name: info.name,
    label: info.name,
    description: info.description,
    parameters: info.parameters,
    ...(info.promptGuidelines ? { promptGuidelines: info.promptGuidelines } : {}),
    async execute() {
      throw new Error("A btw side thread does not run tools.");
    },
  };
}

/** The system prompt and tool declarations the parent sends, unchanged, with no append segments. */
function inheritedResources(ctx: ExtensionContext): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => stripDynamicSystemPromptFooter(ctx.getSystemPrompt()),
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

/**
 * The provider registration the parent holds: extension-registered providers and `--api-key`
 * overrides only exist on the parent's runtime, so the child needs its own copy of them.
 */
async function sideRuntimeOptions(ctx: ExtensionContext, model: Model<Api>) {
  const registry = ctx.modelRegistry;
  const provider = model.provider;
  const nativeProvider = registry.getRegisteredNativeProvider(provider);
  const providerConfig = registry.getRegisteredProviderConfig(provider);
  const runtimeApiKey = registry.getProviderAuthStatus(provider).source === "runtime";
  if (!nativeProvider && !providerConfig && !runtimeApiKey) {
    return {};
  }
  const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
  if (nativeProvider) {
    modelRuntime.registerNativeProvider(nativeProvider);
  } else if (providerConfig) {
    modelRuntime.registerProvider(provider, providerConfig);
  }
  await modelRuntime.refresh({ allowNetwork: false });
  if (runtimeApiKey) {
    const auth = await registry.getApiKeyAndHeaders(model);
    if (auth.ok && auth.apiKey) {
      await modelRuntime.setRuntimeApiKey(provider, auth.apiKey);
    }
  }
  return { modelRuntime };
}

/**
 * A throwaway session whose first request repeats the parent's prefix exactly: same system prompt,
 * same tool declarations, same history up to the anchor. Only the prompt cache depends on this being
 * byte-identical, so nothing here may normalize, filter, or re-render the parent's messages.
 */
export async function openSideSession(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  seeded: readonly (AgentMessage | Message)[],
): Promise<AgentSession> {
  const sessionManager = SessionManager.inMemory(ctx.cwd);
  // Appended raw: bash, summary, and custom entries are normalized into the request at prompt time,
  // exactly as they are for the parent. Filtering or converting them here would change the prefix.
  for (const message of seeded) {
    sessionManager.appendMessage(message as Message);
  }

  const model = ctx.model;
  if (!model) throw new Error("No active model to answer the side question.");

  const active = new Set(pi.getActiveTools());
  const tools = pi.getAllTools().filter((info) => active.has(info.name));

  const runtimeOptions = await sideRuntimeOptions(ctx, model);

  const { session } = await createAgentSession({
    cwd: ctx.cwd,
    sessionManager,
    model,
    thinkingLevel: ctx.thinkingLevel,
    ...runtimeOptions,
    tools: tools.map((info) => info.name),
    customTools: tools.map(stubTool),
    resourceLoader: inheritedResources(ctx),
  });
  return session;
}
