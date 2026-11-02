import { rawKeyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { frame, joinHints, modalBodyRows } from "../shared/frame.ts";

export interface KeyEntry {
  key: string;
  description: string;
}

export interface KeyGroup {
  title: string;
  entries: readonly KeyEntry[];
}

type KeyRow = { kind: "group"; title: string } | { kind: "entry"; key: string; description: string };

function keyRows(groups: readonly KeyGroup[]): KeyRow[] {
  return groups.flatMap((group) => [
    { kind: "group" as const, title: group.title },
    ...group.entries.map((entry) => ({ kind: "entry" as const, ...entry })),
  ]);
}

function maxKeyWidth(groups: readonly KeyGroup[]): number {
  let width = 0;
  for (const group of groups) {
    for (const entry of group.entries) width = Math.max(width, visibleWidth(entry.key));
  }
  return width;
}

/** Body lines for the two-column key list; scrolls over group headings and entries together. */
export function keysContentLines(
  groups: readonly KeyGroup[],
  width: number,
  rows: number,
  offset: number,
  theme: Theme,
): string[] {
  const contentWidth = Math.max(1, width - 4);
  const keyColumn = Math.max(1, Math.min(maxKeyWidth(groups), Math.floor(contentWidth / 2)));
  const descriptionWidth = Math.max(1, contentWidth - keyColumn - 2);
  const all = keyRows(groups);
  const lines: string[] = [];
  for (const row of all.slice(offset, offset + rows)) {
    if (row.kind === "group") {
      lines.push(theme.bold(theme.fg("muted", row.title)));
      continue;
    }
    const key = theme.fg("accent", row.key);
    const padding = " ".repeat(Math.max(0, keyColumn - visibleWidth(row.key)));
    const description = theme.fg("text", truncateToWidth(row.description, descriptionWidth, "", true));
    lines.push(`${key + padding}  ${description}`);
  }
  while (lines.length < rows) lines.push("");
  return lines;
}

export class KeysComponent implements Component {
  private readonly groups: readonly KeyGroup[];
  private readonly theme: Theme;
  private readonly done: () => void;
  private readonly requestRender: () => void;
  private readonly terminalRows: number;
  private offset = 0;

  constructor(
    groups: readonly KeyGroup[],
    theme: Theme,
    done: () => void,
    requestRender: () => void,
    terminalRows: number,
  ) {
    this.groups = groups;
    this.theme = theme;
    this.done = done;
    this.requestRender = requestRender;
    this.terminalRows = terminalRows;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.done();
      return;
    }
    const total = keyRows(this.groups).length;
    const body = modalBodyRows(total, this.terminalRows);
    let next = this.offset;
    if (matchesKey(data, Key.up)) next -= 1;
    else if (matchesKey(data, Key.down)) next += 1;
    else if (matchesKey(data, Key.pageUp)) next -= body;
    else if (matchesKey(data, Key.pageDown)) next += body;
    else return;
    this.offset = Math.max(0, Math.min(total - body, next));
    this.requestRender();
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (width <= 2) return [];
    const total = keyRows(this.groups).length;
    const rows = modalBodyRows(total, this.terminalRows);
    this.offset = Math.max(0, Math.min(total - rows, this.offset));
    const lines = keysContentLines(this.groups, width, rows, this.offset, this.theme);
    return frame(lines, width, this.theme, {
      color: "borderAccent",
      title: this.theme.bold(this.theme.fg("accent", "Keys")),
      hints: joinHints(this.theme, [rawKeyHint("↑↓", "scroll"), rawKeyHint("esc", "close")]),
    });
  }
}
