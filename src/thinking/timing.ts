export interface ThinkingTiming {
  /** Duration of a finished block, keyed by the trimmed markdown the renderer receives. */
  durationFor(markdown: string): number | undefined;
  /** Record a duration for a block, keyed by the trimmed markdown the renderer receives. */
  seed(markdown: string, ms: number): void;
  reset(): void;
}

export function createThinkingTiming(): ThinkingTiming {
  const durations = new Map<string, number>();

  return {
    durationFor(markdown) {
      return durations.get(markdown.trim());
    },
    seed(markdown, ms) {
      const key = markdown.trim();
      if (key !== "" && Number.isFinite(ms) && ms >= 0) durations.set(key, ms);
    },
    reset() {
      durations.clear();
    },
  };
}
