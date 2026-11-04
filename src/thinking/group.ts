/** Consecutive thinking blocks, joined the way the renderer joins them into one markdown. */
export interface ThinkingGroup {
  text: string;
  /** Content indexes of the group's non-empty blocks. */
  indexes: number[];
}

export function groupThinkingBlocks(content: readonly { type: string; thinking?: string }[]): ThinkingGroup[] {
  const groups: ThinkingGroup[] = [];
  let texts: string[] = [];
  let indexes: number[] = [];
  const flush = (): void => {
    if (texts.length > 0) groups.push({ text: texts.join("\n\n"), indexes });
    texts = [];
    indexes = [];
  };
  content.forEach((block, index) => {
    if (block.type !== "thinking") {
      flush();
      return;
    }
    const text = block.thinking?.trim() ?? "";
    if (text === "") return;
    texts.push(text);
    indexes.push(index);
  });
  flush();
  return groups;
}
