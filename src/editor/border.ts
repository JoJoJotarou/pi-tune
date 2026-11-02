import { sliceByColumn, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** Write `label` into the right end of a border line, keeping the line exactly `width` wide. */
export function placeRight(border: string, label: string, width: number): string {
  if (width <= 0) return "";
  const text = truncateToWidth(label, width, "");
  const leftWidth = Math.max(0, width - visibleWidth(text));
  const left = truncateToWidth(sliceByColumn(border, 0, leftWidth), leftWidth, "", true);
  return left + text;
}

/** Write `label` into the left end of a border line, keeping the line exactly `width` wide. */
export function placeLeft(border: string, label: string, width: number): string {
  if (width <= 0) return "";
  const text = truncateToWidth(label, width, "");
  const restWidth = Math.max(0, width - visibleWidth(text));
  const rest = truncateToWidth(sliceByColumn(border, visibleWidth(text), restWidth), restWidth, "", true);
  return text + rest;
}
