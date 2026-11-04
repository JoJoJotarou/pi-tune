import { type ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

/**
 * Pi internals this module relies on, verified against Pi 1.4.0:
 *
 * - `ModelRegistry` is a facade over a `ModelRuntime` that owns the model catalog and the credentials, and it
 *   keeps that runtime in the private `runtime` field. `ModelSelectorComponent` needs the runtime itself, and
 *   extensions only receive the registry.
 *
 * The shape is checked at runtime. A mismatch returns an `Error` so the caller can disable the model picker.
 */
export function modelRuntimeOf(registry: ModelRegistry): ModelRuntime | Error {
  const runtime = (registry as unknown as { runtime?: unknown }).runtime;
  if (runtime instanceof ModelRuntime) return runtime;
  return new Error("pi-tune: the model registry has no ModelRuntime; the model picker is unavailable.");
}
