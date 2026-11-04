import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor, type EditorTheme, SelectList, type Terminal, type TUI, TuiMainScreen } from "@earendil-works/pi-tui";
import { editorHasFocus } from "./focus.ts";

const terminal = { columns: 80, rows: 24, write() {} } as unknown as Terminal;
const editorTheme = { borderColor: (text: string) => text, selectList: {} } as unknown as EditorTheme;

test("tells whether Pi's editor has keyboard focus", () => {
  const tui = new TuiMainScreen(terminal);
  tui.setFocus(new Editor(tui, editorTheme));
  assert.equal(editorHasFocus(tui), true);
  tui.setFocus(new SelectList([], 1, {} as never));
  assert.equal(editorHasFocus(tui), false);
});

test("returns an Error on a screen that does not report focus", () => {
  const result = editorHasFocus({} as TUI);
  assert.ok(result instanceof Error);
  assert.match(result.message, /does not report focus/);
});
