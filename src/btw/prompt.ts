/**
 * Pi composes the prompt it sends from the resource loader's base prompt plus its own dynamic
 * footer (`<cwd>`, and on older prompts the date and working directory lines). `ctx.getSystemPrompt()`
 * returns the composed result, so handing it back unchanged would append the footer twice and move
 * the first differing byte from the end of the history to the middle of the system prompt.
 *
 * The child session recomposes the footer itself, so the base prompt it needs is the parent's prompt
 * with exactly that footer cut off.
 */
export function stripDynamicSystemPromptFooter(prompt: string): string {
  return prompt
    .replace(/\n\n<cwd>\n[^\n]*\n<\/cwd>\s*$/u, "")
    .replace(/\nCurrent date and time:[^\n]*(?:\nCurrent working directory:[^\n]*)?\s*$/u, "")
    .replace(/\nCurrent working directory:[^\n]*\s*$/u, "")
    .trimEnd();
}
