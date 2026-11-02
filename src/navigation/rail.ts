export type RailCell = "tick" | "current" | "thumb" | "empty";

export interface RailPrompt {
  row: number;
}

function toRail(row: number, total: number, height: number): number {
  return Math.min(height - 1, Math.floor((row / Math.max(total, 1)) * height));
}

export function railCells({
  prompts,
  total,
  viewportTop,
  height,
}: {
  prompts: readonly RailPrompt[];
  total: number;
  viewportTop: number;
  height: number;
}): RailCell[] {
  if (height <= 0 || total <= height || prompts.length === 0) return [];

  const cells: RailCell[] = Array.from({ length: height }, () => "empty");
  const thumbStart = toRail(viewportTop, total, height);
  const thumbEnd = Math.max(thumbStart, toRail(viewportTop + height - 1, total, height));
  for (let y = thumbStart; y <= thumbEnd; y++) cells[y] = "thumb";

  const current = [...prompts].reverse().find((prompt) => prompt.row <= viewportTop + 1) ?? prompts[0];
  for (const prompt of prompts) {
    const y = toRail(prompt.row, total, height);
    if (prompt === current) cells[y] = "current";
    else if (cells[y] !== "current") cells[y] = "tick";
  }
  return cells;
}

export function nearestPrompt<T extends RailPrompt>(
  prompts: readonly T[],
  total: number,
  height: number,
  y: number,
): T | undefined {
  if (prompts.length === 0) return undefined;
  let best = prompts[0];
  for (const prompt of prompts.slice(1)) {
    const distance = Math.abs(toRail(prompt.row, total, height) - y);
    const bestDistance = Math.abs(toRail(best.row, total, height) - y);
    if (distance < bestDistance) best = prompt;
  }
  return best;
}
