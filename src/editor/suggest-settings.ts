import { writeFileSync } from "node:fs";
import { isRecord, readJsonObject } from "../shared/config.ts";

/** `careful` (the default) suggests only an obvious next line; `eager` whenever a natural one exists. */
export const SUGGEST_STYLES = ["careful", "eager"] as const;
export type SuggestStyle = (typeof SUGGEST_STYLES)[number];

export interface SuggestSettings {
  enabled: boolean;
  /** `provider/id`; absent means the session model. */
  model?: string;
  /** Absent means `careful`. */
  style?: SuggestStyle;
}

export type SuggestSettingsLoad = { ok: true; settings: SuggestSettings } | { ok: false; problem: string };

/** Read the settings from `path`; a missing file or a missing `suggest` key means off. */
export function loadSuggestSettings(path: string): SuggestSettingsLoad {
  const read = readJsonObject(path);
  if (!read.ok) return { ok: false, problem: `Next-step suggestions off: ${path} ${read.problem}.` };
  if (read.value === undefined || !("suggest" in read.value)) return { ok: true, settings: { enabled: false } };
  const suggest = read.value.suggest;
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
  if ("style" in suggest && !isStyle(suggest.style)) {
    return {
      ok: false,
      problem: `Next-step suggestions off: ${path} has a "suggest.style" value that is not ${SUGGEST_STYLES.join(" or ")}.`,
    };
  }
  const settings: SuggestSettings = { enabled: suggest.enabled === true };
  if (typeof suggest.model === "string") settings.model = suggest.model;
  if (isStyle(suggest.style)) settings.style = suggest.style;
  return { ok: true, settings };
}

/** Write `settings` back, keeping every other top-level key of the file. */
export function saveSuggestSettings(path: string, settings: SuggestSettings): void {
  const read = readJsonObject(path);
  if (!read.ok) throw new Error(`${path} ${read.problem}`);
  const suggest: Record<string, unknown> = { enabled: settings.enabled };
  if (settings.model !== undefined) suggest.model = settings.model;
  if (settings.style !== undefined) suggest.style = settings.style;
  writeFileSync(path, `${JSON.stringify({ ...read.value, suggest }, null, 2)}\n`);
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
    if (head === "model" && value === "session") {
      const { model: _session, ...rest } = current;
      return { settings: rest };
    }
    if (head === "style" && isStyle(value)) return { settings: { ...current, style: value } };
    if (head === "model" && value !== undefined) {
      return isModel(value)
        ? { settings: { ...current, model: value } }
        : { error: `Next-step suggestion model "${value}" is not a known provider/model.` };
    }
  }
  return { error: "Usage: /suggest [on|off|model <provider/id|session>|style <careful|eager>]" };
}

function isStyle(value: unknown): value is SuggestStyle {
  return SUGGEST_STYLES.includes(value as SuggestStyle);
}
