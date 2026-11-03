/** Columns of a tool block the navigation timeline's rail covers, from the last `RAIL_CHANNEL` report. */
let covered = 0;

/** Whole columns only, so a bad report reads as `no rail` rather than breaking every line width. */
export function setRailCoveredColumns(columns: number): void {
  covered = Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 0;
}

export function railCoveredColumns(): number {
  return covered;
}
