import type { Theme } from "@earendil-works/pi-coding-agent";
import type { StructuredPatchHunk } from "diff";

export interface DiffStats {
  added: number;
  removed: number;
}

export interface RenderDiffOptions {
  path: string;
  width: number;
  theme: Theme;
  context?: number;
}

export function hunksFromPatch(_patch: string): StructuredPatchHunk[] {
  throw new Error("not implemented");
}

export function hunksFromTexts(_oldText: string, _newText: string, _context?: number): StructuredPatchHunk[] {
  throw new Error("not implemented");
}

export function diffStats(_hunks: StructuredPatchHunk[]): DiffStats {
  throw new Error("not implemented");
}

export function renderDiff(_hunks: StructuredPatchHunk[], _options: RenderDiffOptions): string[] {
  throw new Error("not implemented");
}
