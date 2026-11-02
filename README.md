# pi-tune

Tune Pi Agent's interactive TUI: a denser transcript, clearer tool and Markdown rendering, navigation for long
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
| `tools.ts` | Built-in tool calls take one line: status, summary, result counts and duration. Failures show the first and last lines of output; `edit` and `write` show a two-column diff, folded above 8 changed lines. `ctrl+o` still expands everything. |
| `thinking.ts` | Thinking folds to `◆ Thought 3.4s · 5 lines`; while streaming, only the last two lines show. `ctrl+o` shows the full text. |
| `navigation.ts` | Fullscreen only: a timeline on the right edge (click a tick, or `/timeline`), new prompts flip to the top of the screen, and the current prompt stays pinned while you scroll up. |
| `viewer.ts` | `alt+o` or `/view` opens the latest tool output or code block in an overlay with scroll, search (`/`), copy (`y`) and `[` `]` to switch blocks. |
| `markdown.ts` | `###` headings without hashes, link hosts after links, tables that do not fit become lists, code blocks over 20 lines fold to 12. |
| `mermaid.ts` | Mermaid diagrams get a preview link that opens in the browser, and a pointer to copy the source from the viewer. |
| `status.ts` | The working line says what is running and for how long. Runs of 15 s or more end with a desktop notification and a done title. |
| `editor.ts` | `ctrl+v` collapses large pastes like `cmd+v`; `enter` or a double click on a paste marker previews it; the editor border shows the model and thinking level; `ctrl+s` stashes a draft. |
| `chrome.ts` | One-line header and footer; the footer's key hints follow what Pi is doing. |

## Recommended settings

In `~/.pi/agent/settings.json`:

```json
{
  "quietStartup": "header",
  "markdown": { "mermaid": "off" },
  "fullscreenScrollbar": "always"
}
```

- `quietStartup` hides the `[Extensions]` / `[Skills]` listing that extensions cannot hide.
- `markdown.mermaid: "off"` hands Mermaid diagrams to `mermaid.ts`; without it, Pi draws them itself.
- `fullscreenScrollbar: "always"` reserves the right-hand column that the timeline draws in.

The timeline, page flip and pinned prompt rely on Pi 1.4 internals. If a Pi update changes them, those features turn
themselves off with a warning instead of misbehaving.

## Develop

See `AGENTS.md` for the layout, commands and rules, and `test/e2e/README.md` for the end-to-end harness.
