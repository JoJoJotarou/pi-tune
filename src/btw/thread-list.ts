import { DynamicBorder, getSelectListTheme, rawKeyHint, type Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type SelectItem, SelectList, truncateToWidth } from "@earendil-works/pi-tui";
import { joinHints } from "../shared/frame.ts";
import type { BtwThread } from "./thread.ts";

/** The list row that starts a new thread instead of opening one. */
export const NEW_THREAD = "new";

const MAX_VISIBLE = 10;

/** `New thread`, then every asked thread newest first, named by its number and first question. */
export function threadItems(threads: readonly BtwThread[], mainTurns: number): SelectItem[] {
  const items = threads.flatMap((thread, index): SelectItem[] => {
    if (thread.turns.length === 0) return [];
    const turns = `${thread.turns.length} turn${thread.turns.length === 1 ? "" : "s"}`;
    const behind = mainTurns - thread.anchorTurns;
    return [
      {
        value: thread.id,
        label: `#${index + 1} ${thread.turns[0].question}`,
        description: [turns, `@turn ${thread.anchorTurns}`, ...(behind > 0 ? [`main +${behind}`] : [])].join(" · "),
      },
    ];
  });
  return [
    { value: NEW_THREAD, label: "New thread", description: `sees main up to turn ${mainTurns}` },
    ...items.reverse(),
  ];
}

export interface ThreadListOptions {
  items: SelectItem[];
  /** The row the cursor starts on. */
  selected?: string;
  tui: { requestRender(): void };
  theme: Theme;
  /** The picked row's value, or undefined on cancel. */
  done: (value: string | undefined) => void;
}

/** `/btw` without a question: Pi's select list in the editor's place, framed like Pi's own pickers. */
export class ThreadList implements Component {
  private readonly border = new DynamicBorder();
  private readonly list: SelectList;
  private readonly tui: { requestRender(): void };
  private readonly theme: Theme;

  constructor(options: ThreadListOptions) {
    this.tui = options.tui;
    this.theme = options.theme;
    this.list = new SelectList(options.items, Math.min(options.items.length, MAX_VISIBLE), getSelectListTheme());
    const start = options.items.findIndex((item) => item.value === options.selected);
    if (start >= 0) this.list.setSelectedIndex(start);
    this.list.onSelect = (item) => options.done(item.value);
    this.list.onCancel = () => options.done(undefined);
  }

  render(width: number): string[] {
    const border = this.border.render(width);
    const hint = joinHints(this.theme, [
      rawKeyHint("↑↓", "select"),
      rawKeyHint("enter", "open"),
      rawKeyHint("esc", "cancel"),
    ]);
    return [...border, ...this.list.render(width), truncateToWidth(` ${hint}`, width), ...border];
  }

  invalidate(): void {
    this.border.invalidate();
    this.list.invalidate();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
    this.tui.requestRender();
  }
}
