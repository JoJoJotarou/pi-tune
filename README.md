# pi-tune

Tune Pi Agent's interactive TUI: a denser transcript, clearer tool rendering, navigation for long
sessions, and a better input box and status line. Built for Pi 1.4.

Each screen area is its own extension under `extensions/`, so you can turn any of them off with `pi config`.

## Try it

Run Pi once with the package loaded, without installing it:

```sh
git clone https://github.com/JoJoJotarou/pi-tune.git
cd pi-tune && npm ci
pi -e /path/to/pi-tune
```

Or install it for every session:

```sh
pi install /path/to/pi-tune
```

## What each extension does

| Extension | What changes |
|---|---|
| `tools.ts` | Built-in tool calls fold to one line in Pi's own pending, success and error colors: summary, result counts and duration. Click a block to expand it, or `ctrl+o` for all. `edit` and `write` diffs tint whole added and removed rows and the changed words, and preview from the first change. `ls`, `find`, `grep` results and `codemode`'s inner calls show as trees. |
| `thinking.ts` | Folded thinking reads `◆ Thinking · click to expand`; an open block starts with `◆ Thought for 3.4s`. Click toggles one block, `ctrl+t` all of them. |
| `navigation.ts` | Fullscreen only: a timeline over the scrollbar column (hover a tick to see its prompt, click it or `▴` `▾` to jump, or `/timeline`). It hides below 60 columns or with fewer than 2 prompts. |
| `status.ts` | The input box's top border says what is running and for how long. Runs of 15 s or more end with a done title in the terminal title bar. |
| `editor.ts` | A rounded input box with the model and thinking level on its border. `ctrl+v` collapses large pastes like `cmd+v`; `enter` on a paste marker, or a double click on it, previews it; `ctrl+s` stashes a draft and asks before it replaces a held one. After a run settles, one dim next-step suggestion fills the empty box and `tab` accepts it (an extra one-shot completion; `PI_TUNE_EDITOR_SUGGEST=off` disables it, `PI_TUNE_SUGGEST_MODEL=provider/model` picks the model). A failed request warns once and stops suggestions for the session; an unknown model setting warns at startup and disables them for the session. |
| `chrome.ts` | One-line header with the skill count and connected/configured MCP servers on the right; the footer shows the folder, branch, Pi's own token and context stats and the token rate, and its key hints follow what Pi is doing. |

## Recommended settings

In `~/.pi/agent/settings.json`:

```json
{
  "hideThinkingBlock": true,
  "quietStartup": "header",
  "fullscreenScrollbar": "always"
}
```

- `hideThinkingBlock` starts thinking folded; without it, every block opens expanded.
- `quietStartup` hides the `[Extensions]` / `[Skills]` listing that extensions cannot hide.
- `fullscreenScrollbar: "always"` reserves the right-hand column that the timeline draws over, so it never covers
  text. While the timeline is hidden, Pi 1.4 copies that scrollbar along with selected lines.

The timeline relies on Pi 1.4 internals. If a Pi update changes them, it turns itself off with a warning instead of
misbehaving.

## Terminal notes

- On macOS, Pi's `alt+enter` (follow-up while Pi runs) needs the option key to send meta: in Ghostty set
  `macos-option-as-alt = true`, in Zed set `"terminal": { "option_as_meta": true }`.
- Zed shows the terminal title in its breadcrumb bar only, not on the tab.

## Develop

See `AGENTS.md` for the layout, commands and rules, and `test/e2e/README.md` for the end-to-end harness.
