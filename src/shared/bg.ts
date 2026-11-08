import type { Theme, ThemeBg } from "@earendil-works/pi-coding-agent";

const RESET_ALL = "\u001b[0m";
const BG_OFF = "\u001b[49m";

/**
 * Paints a whole block line with `token`. It re-applies the background after any full reset an inner
 * component emitted, so styled text never leaves a hole in the block.
 */
export function blockBackground(token: ThemeBg, theme: Theme): (text: string) => string {
  const open = theme.bg(token, "").replace(BG_OFF, "");
  return (text) => `${open}${text.split(RESET_ALL).join(`${RESET_ALL}${open}`)}${BG_OFF}`;
}
