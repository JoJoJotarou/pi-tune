import type { ThemeColor } from "@earendil-works/pi-coding-agent";

/**
 * Channel on which the btw area reports whether btw mode is on: the drawer is open and Enter sends the editor's text to
 * the side thread. The editor area recolors its border and labels it while the payload is `true`.
 */
export const BTW_MODE_CHANNEL = "pi-tune:btw-mode";

/** Border color of the drawer and, in btw mode, of the editor, so the two read as one unit. */
export const BTW_BORDER: ThemeColor = "borderAccent";
