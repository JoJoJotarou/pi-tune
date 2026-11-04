import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface SuggestSettings {
  enabled: boolean;
  /** `provider/id`; absent means the session model. */
  model?: string;
}

export type SuggestSettingsLoad = { ok: true; settings: SuggestSettings } | { ok: false; problem: string };

/** Read the settings from `path`; a missing file or a missing `suggest` key means off. */
export function loadSuggestSettings(path: string): SuggestSettingsLoad {
  if (!existsSync(path)) return { ok: true, settings: { enabled: false } };
  return parseSuggestSettings(readFileSync(path, "utf8"), path);
}

export function parseSuggestSettings(raw: string, path: string): SuggestSettingsLoad {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, problem: `Next-step suggestions off: ${path} is not valid JSON (${detail}).` };
  }
  if (!isRecord(value)) {
    return { ok: false, problem: `Next-step suggestions off: ${path} must contain a JSON object.` };
  }
  if (!("suggest" in value)) return { ok: true, settings: { enabled: false } };
  const suggest = value.suggest;
  if (!isRecord(suggest)) {
    return { ok: false, problem: `Next-step suggestions off: ${path} has a "suggest" value that is not an object.` };
  }
  if ("enabled" in suggest && typeof suggest.enabled !== "boolean") {
    return {
      ok: false,
      problem: `Next-step suggestions off: ${path} has a "suggest.enabled" value that is not true or false.`,
    };
  }
  if ("model" in suggest && typeof suggest.model !== "string") {
    return {
      ok: false,
      problem: `Next-step suggestions off: ${path} has a "suggest.model" value that is not a string.`,
    };
  }
  const settings: SuggestSettings = { enabled: suggest.enabled === true };
  if (typeof suggest.model === "string") settings.model = suggest.model;
  return { ok: true, settings };
}

/** Write `settings` back, keeping every other top-level key of the file. */
export function saveSuggestSettings(path: string, settings: SuggestSettings): void {
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`${path} is not valid JSON (${detail})`);
    }
    if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`);
    existing = parsed;
  }
  const suggest: Record<string, unknown> = { enabled: settings.enabled };
  if (settings.model !== undefined) suggest.model = settings.model;
  writeFileSync(path, `${JSON.stringify({ ...existing, suggest }, null, 2)}\n`);
}

/** `provider/id` split at the first slash; undefined when either side is empty. */
export function parseModelId(value: string): { provider: string; id: string } | undefined {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return undefined;
  return { provider: value.slice(0, slash), id: value.slice(slash + 1) };
}

export type SuggestCommand = { settings: SuggestSettings } | { error: string };

/** The settings `/suggest <args>` leads to; the switch and the model change independently. */
export function suggestCommand(
  args: string,
  current: SuggestSettings,
  isModel: (value: string) => boolean,
): SuggestCommand {
  const [head, value, ...extra] = args.trim().split(/\s+/).filter(Boolean);
  if (extra.length === 0) {
    if (head === "on" && value === undefined) return { settings: { ...current, enabled: true } };
    if (head === "off" && value === undefined) return { settings: { ...current, enabled: false } };
    if (head === "model" && value === "session") return { settings: { enabled: current.enabled } };
    if (head === "model" && value !== undefined) {
      return isModel(value)
        ? { settings: { ...current, model: value } }
        : { error: `Next-step suggestion model "${value}" is not a known provider/model.` };
    }
  }
  return { error: "Usage: /suggest [on|off|model <provider/id|session>]" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
