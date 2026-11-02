/**
 * Read a collapsed paste from the base editor's private `pastes` map.
 * Returns an Error when the runtime shape is not the expected `Map<number, string>`.
 */
export function readEditorPaste(editor: unknown, id: number): string | Error {
  const pastes = (editor as { pastes?: unknown } | undefined)?.pastes;
  if (!(pastes instanceof Map)) {
    return new Error("editor has no paste store");
  }
  for (const [key, value] of pastes) {
    if (typeof key !== "number" || typeof value !== "string") {
      return new Error("editor paste store has an unexpected shape");
    }
  }
  const content = pastes.get(id);
  if (typeof content !== "string") {
    return new Error(`paste #${id} is not available`);
  }
  return content;
}
