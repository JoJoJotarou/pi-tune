import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";

/** The rendering rule every component must keep: no line wider than the width it was given. */
export function assertFits(lines: readonly string[], width: number): void {
  for (const line of lines) {
    assert.ok(visibleWidth(line) <= width, `width ${width}, got ${visibleWidth(line)}: ${JSON.stringify(line)}`);
  }
}
