/**
 * Channel on which the navigation area reports how many transcript columns its rail covers. The rail is an overlay:
 * it sits on top of the transcript's right columns instead of narrowing it, so the tools area pads right-aligned text
 * by that width. The payload is a column count, zero while the rail is off.
 */
export const RAIL_CHANNEL = "pi-tune:rail-columns";
