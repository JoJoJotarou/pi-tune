import { Editor, type TUI, TuiAltScreen, TuiMainScreen } from "@earendil-works/pi-tui";

/**
 * Pi internals this module relies on, verified against Pi 1.4.0:
 *
 * - The `TUI` interface extensions receive does not expose focus. Both screens Pi runs on, `TuiAltScreen`
 *   (fullscreen) and `TuiMainScreen` (regular), inherit a public `getFocusedComponent()`, and Pi's editor and every
 *   custom editor extend pi-tui's `Editor`.
 *
 * The shape is checked at runtime. A mismatch returns an `Error` so the caller can leave the keys to Pi.
 */
export function editorHasFocus(tui: TUI): boolean | Error {
  if (!(tui instanceof TuiAltScreen) && !(tui instanceof TuiMainScreen)) {
    return new Error("pi-tune btw: this Pi screen does not report focus; esc and shift+↑↓ stay with Pi.");
  }
  return tui.getFocusedComponent() instanceof Editor;
}
