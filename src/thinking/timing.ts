export interface ThinkingTiming {
  /** Remember when the current thinking block started. */
  start(now: number): void;
  /** Store the duration of a finished block, keyed by its trimmed text. */
  finish(content: string, now: number): void;
  /** Start of the block being streamed, if any. */
  startedAt(): number | undefined;
  /** Duration of a finished block, keyed by the trimmed markdown the renderer receives. */
  durationFor(markdown: string): number | undefined;
  /** Pre-fill a duration for a block that will not stream again (session resume). */
  seed(markdown: string, ms: number): void;
  reset(): void;
}

export function createThinkingTiming(): ThinkingTiming {
  let started: number | undefined;
  const durations = new Map<string, number>();

  return {
    start(now) {
      started = now;
    },
    finish(content, now) {
      if (started !== undefined) durations.set(content.trim(), now - started);
      started = undefined;
    },
    startedAt() {
      return started;
    },
    durationFor(markdown) {
      return durations.get(markdown.trim());
    },
    seed(markdown, ms) {
      const key = markdown.trim();
      if (key !== "" && Number.isFinite(ms) && ms >= 0) durations.set(key, ms);
    },
    reset() {
      started = undefined;
      durations.clear();
    },
  };
}
