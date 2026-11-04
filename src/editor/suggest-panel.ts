import { DynamicBorder, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { type Component, type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import type { SuggestSettings } from "./suggest-settings.ts";

/** The `Model` row's value when the suggestion follows the conversation's model. */
export const SESSION_MODEL = "session model";

export interface SuggestPanelOptions {
  settings: SuggestSettings;
  tui: { requestRender(): void };
  /** Saves and applies the new settings; returns the settings that ended up in effect. */
  onChange: (next: SuggestSettings) => SuggestSettings;
  onClose: () => void;
  /** Builds the model picker; `done` gets the picked `provider/id`, or nothing on cancel. */
  modelPicker: ((done: (modelId?: string) => void) => Component) | Error;
  onWarning: (message: string) => void;
}

/**
 * `/suggest` without arguments: a settings list with the switch and, while it is on, the model row.
 * `SettingsList` items are fixed, so every change rebuilds the list with the cursor back on the first row.
 */
export class SuggestPanel implements Component {
  private readonly options: SuggestPanelOptions;
  /** Same frame as Pi's own selectors, including the model selector this panel opens. */
  private readonly border = new DynamicBorder();
  private settings: SuggestSettings;
  private list: SettingsList;

  constructor(options: SuggestPanelOptions) {
    this.options = options;
    this.settings = options.settings;
    this.list = this.buildList();
  }

  render(width: number): string[] {
    const border = this.border.render(width);
    return [...border, ...this.list.render(width), ...border];
  }

  invalidate(): void {
    this.border.invalidate();
    this.list.invalidate();
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
    this.options.tui.requestRender();
  }

  private buildList(): SettingsList {
    const items = this.items();
    return new SettingsList(
      items,
      Math.min(items.length + 2, 15),
      getSettingsListTheme(),
      (id, value) => this.change(id, value),
      () => this.options.onClose(),
    );
  }

  private items(): SettingItem[] {
    const items: SettingItem[] = [
      {
        id: "enabled",
        label: "Next-step suggestions",
        currentValue: this.settings.enabled ? "on" : "off",
        values: ["on", "off"],
      },
    ];
    if (!this.settings.enabled) return items;
    const value = this.settings.model ?? SESSION_MODEL;
    const picker = this.options.modelPicker;
    items.push(
      picker instanceof Error
        ? // Enter on a single-value row emits the value again, which is where the warning is shown.
          { id: "model", label: "Model", currentValue: value, values: [value] }
        : {
            id: "model",
            label: "Model",
            currentValue: value,
            submenu: (_current, done) => picker((modelId) => done(modelId)),
          },
    );
    return items;
  }

  private change(id: string, value: string): void {
    let next: SuggestSettings;
    if (id === "enabled") {
      next = { ...this.settings, enabled: value === "on" };
    } else if (id === "model") {
      const picker = this.options.modelPicker;
      if (picker instanceof Error) {
        this.options.onWarning(picker.message);
        return;
      }
      next =
        value === SESSION_MODEL ? { enabled: this.settings.enabled } : { enabled: this.settings.enabled, model: value };
    } else {
      return;
    }
    this.settings = this.options.onChange(next);
    this.list = this.buildList();
    this.list.selectItem(id);
    this.options.tui.requestRender();
  }
}
