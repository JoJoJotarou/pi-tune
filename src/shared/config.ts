import { readFileSync } from "node:fs";

/** A missing file reads as `ok` without a value; `problem` completes a sentence that starts with the path. */
export type JsonObjectRead = { ok: true; value?: Record<string, unknown> } | { ok: false; problem: string };

export function readJsonObject(path: string): JsonObjectRead {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ok: true };
    return { ok: false, problem: `could not be read (${(error as Error).message})` };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return { ok: false, problem: `is not valid JSON (${(error as Error).message})` };
  }
  if (!isRecord(value)) return { ok: false, problem: "must contain a JSON object" };
  return { ok: true, value };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
