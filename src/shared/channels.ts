/**
 * Channel on which the btw area reports whether btw mode is on: the drawer is open and Enter sends the editor's text to
 * the side thread. The editor area recolors its border and labels it while the payload is `true`.
 */
export const BTW_MODE_CHANNEL = "pi-tune:btw-mode";

/**
 * Channel on which the navigation area reports how many transcript columns its rail covers. The rail is an overlay:
 * it sits on top of the transcript's right columns instead of narrowing it, so the tools area pads right-aligned text
 * by that width. The payload is a column count, zero while the rail is off.
 */
export const RAIL_CHANNEL = "pi-tune:rail-columns";

/** Channel on which the editor area reports that its custom editor is mounted, so the footer can offer its keys. */
export const EDITOR_READY_CHANNEL = "pi-tune:editor-ready";

/** Channel on which the editor area reports whether a draft sits in its stash; the payload is `true` while one does. */
export const EDITOR_STASH_CHANNEL = "pi-tune:editor-stash";
