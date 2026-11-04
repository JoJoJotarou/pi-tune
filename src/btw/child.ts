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
  createBashToolDefinition,
  createEditToolDefinition,
  createExtensionRuntime,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { stripDynamicSystemPromptFooter } from "./prompt.ts";
import { type BtwRules, judge } from "./rules.ts";
import { type SandboxKind, sandboxCommand } from "./sandbox.ts";

export interface SideToolOptions {
  rules: BtwRules;
  /** The settings file, named in the error a refused call returns. */
  rulesPath: string;
  /** The read-only sandbox allowed bash commands run in, detected on first use; an `Error` runs them bare. */
  sandbox: () => SandboxKind | Error;
  onDenied: (label: string) => void;
  /** Called on every unsandboxed bash run; the caller decides how often to show it. */
  onUnsandboxed: (problem: Error) => void;
}

type ToolInfo = ReturnType<ExtensionAPI["getAllTools"]>[number];
// biome-ignore lint/suspicious/noExplicitAny: the built-in definitions differ only in their parameter schemas.
type AnyToolDefinition = ToolDefinition<any, any, any>;

/** Pi's own implementation of a built-in tool; extension tools only run in the session that registered them. */
function builtInTool(name: string, cwd: string, options: SideToolOptions): AnyToolDefinition | undefined {
  switch (name) {
    case "read":
      return createReadToolDefinition(cwd);
    case "grep":
      return createGrepToolDefinition(cwd);
    case "find":
      return createFindToolDefinition(cwd);
    case "ls":
      return createLsToolDefinition(cwd);
    case "edit":
      return createEditToolDefinition(cwd);
    case "write":
      return createWriteToolDefinition(cwd);
    case "bash":
      return createBashToolDefinition(cwd, {
        spawnHook: (context) => {
          const kind = options.sandbox();
          if (kind instanceof Error) {
            options.onUnsandboxed(kind);
            return context;
          }
          return { ...context, command: sandboxCommand(kind, context.command) };
        },
      });
    default:
      return undefined;
  }
}

/**
 * A tool that serializes exactly like the parent's, so the request prefix stays byte-identical, and runs a
 * call only when the btw rules allow it. A refused call throws, which the model receives as an error result.
 */
export function sideTool(info: ToolInfo, cwd: string, options: SideToolOptions): ToolDefinition {
  return {
    name: info.name,
    label: info.name,
    description: info.description,
    parameters: info.parameters,
    ...(info.promptGuidelines ? { promptGuidelines: info.promptGuidelines } : {}),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const verdict = judge(info.name, params, options.rules);
      if (!verdict.allowed) {
        options.onDenied(verdict.label);
        throw new Error(
          `${verdict.label} ${verdict.reason} for btw threads. The user can allow it in "btw.allow" of ${options.rulesPath}.`,
        );
      }
      const tool = builtInTool(info.name, cwd, options);
      if (!tool) {
        options.onDenied(`${info.name} (main session only)`);
        throw new Error(`${info.name} runs only in the main session; a btw thread can run Pi's built-in tools.`);
      }
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
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
  tools: SideToolOptions,
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
  const declared = pi.getAllTools().filter((info) => active.has(info.name));

  const runtimeOptions = await sideRuntimeOptions(ctx, model);

  const { session } = await createAgentSession({
    cwd: ctx.cwd,
    sessionManager,
    model,
    thinkingLevel: ctx.thinkingLevel,
    ...runtimeOptions,
    tools: declared.map((info) => info.name),
    customTools: declared.map((info) => sideTool(info, ctx.cwd, tools)),
    resourceLoader: inheritedResources(ctx),
  });
  return session;
}
