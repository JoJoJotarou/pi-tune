# pi-tune

Tune Pi Agent's interactive TUI: a denser transcript, clearer tool rendering, navigation for long
sessions, and a better input box and footer. Built for Pi 1.4.

Each screen area is its own extension under `extensions/`, so you can turn any of them off with `pi config`.

## Install

```sh
pi install npm:pi-tune@0.1.0   # every session
pi -e npm:pi-tune              # one run, without installing
```

From a checkout, `npm ci && pi -e .` runs the working tree and `pi install .` installs it.

## What each extension does

| Extension | What changes |
|---|---|
| `tools.ts` | Built-in tool calls fold to one line in Pi's own pending, success and error colors: summary, result counts and duration. Click a block to expand it, or `ctrl+o` for all. `edit` and `write` diffs tint whole added and removed rows and the changed words, and preview from the first change. `ls`, `find`, `grep` results and `codemode`'s inner calls show as trees. |
| `thinking.ts` | Folded thinking reads `◆ Thinking · click to expand`; an open block starts with `◆ Thought for 3.4s`. Click toggles one block, `ctrl+t` all of them. |
| `navigation.ts` | Fullscreen only: a timeline over the scrollbar column (hover a tick to see its prompt, click it or `▴` `▾` to jump, or `/timeline`). It hides below 60 columns or with fewer than 2 prompts. |
| `status.ts` | The input box's top border says what is running and for how long. Runs of 15 s or more end with a done title in the terminal title bar. |
| `editor.ts` | A rounded input box with the model and thinking level on its border. `ctrl+v` collapses large pastes like `cmd+v`; `enter` on a paste marker, or a double click on it, previews it; `ctrl+s` stashes a draft and asks before it replaces a held one. After a run settles, one dim next-step suggestion fills the empty box: `tab` or `→` accepts it, typing its start keeps the rest showing, and `esc` dismisses it (Pi still counts it toward a double `esc`). It is off by default: `/suggest` opens a panel where enter turns it on or off; while it is on, a `Model` row (the session model unless you pick one in Pi's model selector) and a `Style` row appear: `careful` suggests only an obvious next line, `eager` whenever a natural one exists. `/suggest on`, `/suggest off`, `/suggest model <provider/id|session>` and `/suggest style <careful|eager>` do the same. The choice is saved in `~/.pi/agent/pi-tune.json`. It costs an extra request per run that Pi's footer usage does not count; the request uses the model's lowest thinking level and gives up after 45 s; a run that ends in an error asks for nothing, and after ten unused suggestions in a row only every third run asks until you take one. A failed request warns once and stops suggestions for the session; an unknown model setting warns at startup and disables them for the session. |
| `btw.ts` | Side questions that stay out of the main conversation. `/btw <question>` starts a new thread and opens a drawer above the input box; while it is open the box turns the drawer's color and `enter` asks in that thread. The question shows at once with a spinner and the answer streams in; `esc` stops it and puts the question back in the box. `esc` on the empty box closes the drawer and keeps the thread; `/btw` alone lists the threads to continue one or start a new one. The drawer takes up to half the screen (16 rows at most) and scrolls with the wheel or `shift+↑↓`. Questions sit in the same block as the main session's own; the bottom border shows the latest answer's time, cache hit and cost. Its top border shows the main turn the thread starts from and, in warning color, how many main turns it cannot see. A side request repeats the main session's system prompt, tools and history byte for byte, so the provider's prompt cache covers the main session. Side threads run Pi's built-in tools that `btw.allow` in `~/.pi/agent/pi-tune.json` names (default `["read", "grep", "find", "ls"]`) unless `btw.deny` names them too; `*` matches anything, `mcp__docs__*` names tools and `bash(tinyfish *)` commands, and every command of a compound bash line must match; the rules are read before every question, so an edit applies without `/reload`. The model is told up front which calls run there; a refused call returns an error naming the rule that would allow it, and is listed under the answer. Allowed bash commands run read-only in `sandbox-exec` on macOS or `bwrap` on Linux, with network as usual; without either, pi-tune warns once. Tool calls are not drawn: the spinner row names the one running. |
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

## Release

`npm version <patch|minor|major> -m "chore(release): %s"` commits the bump and creates the annotated `vX.Y.Z`
tag. Pushing that tag makes `.github/workflows/release.yml` rerun `npm run ci`, publish to npm with provenance
and create the GitHub Release; it needs the `NPM_TOKEN` repository secret.
