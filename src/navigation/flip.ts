/**
 * Page flip on send: the new prompt sits at the viewport top and the answer writes downward. A spacer after the
 * chat keeps the document tall enough for the viewport to reach the prompt row, and shrinks as the answer grows so
 * the view does not move until the answer fills the viewport.
 */
export interface FlipState {
  readonly promptRow: number;
  readonly viewportHeight: number;
  readonly padding: number;
  readonly done: boolean;
}

function paddingFor(promptRow: number, chatEnd: number, viewportHeight: number): number {
  return Math.max(0, viewportHeight - (chatEnd - promptRow));
}

export function startFlip(promptRow: number, chatEnd: number, viewportHeight: number): FlipState {
  const padding = paddingFor(promptRow, chatEnd, viewportHeight);
  return { promptRow, viewportHeight, padding, done: padding === 0 };
}

export function updateFlip(state: FlipState, chatEnd: number): FlipState {
  if (state.done) return state;
  const padding = paddingFor(state.promptRow, chatEnd, state.viewportHeight);
  return { ...state, padding, done: padding === 0 };
}
