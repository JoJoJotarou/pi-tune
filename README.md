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
| `tools.ts` | Built-in tool calls fold to one line in Pi's own pending, success and error colors: summary, result counts and duration. Click a block to expand it, or `ctrl+o` for all. `edit` and `write` use Pi's diff and preview from the first change; `codemode` lists the tools its script called. |
| `thinking.ts` | Folded thinking reads `◆ Thinking · click to expand · ctrl+t all`; an open block starts with `◆ Thought 3.4s · 5 lines`. Click toggles one block, `ctrl+t` all of them. |
| `navigation.ts` | Fullscreen only: a timeline over the scrollbar column (hover a tick to see its prompt, click it or `▴` `▾` to jump, or `/timeline`), and the current prompt stays pinned, up to 3 lines, while you scroll up. The timeline hides below 60 columns or with fewer than 2 prompts. |
| `viewer.ts` | `alt+o` or `/view` opens the latest tool output or code block in a modal with scroll, search (`/`), copy (`y`) and `[` `]` to switch blocks. |
| `markdown.ts` | Bold in the heading color, `###` headings without hashes, link hosts after links, code blocks over 20 lines fold to 12. Local images show inline in terminals with the kitty image protocol (Ghostty, kitty, WezTerm); remote images are never fetched and show as a link. |
| `mermaid.ts` | Mermaid diagrams get a preview link that opens in the browser (pan, zoom, copy source), and `alt+o` to view or copy the source. |
| `status.ts` | The input box's top border says what is running and for how long. Runs of 15 s or more end with a done title in the terminal title bar. |
| `editor.ts` | A rounded input box with the model and thinking level on its border. `ctrl+v` collapses large pastes like `cmd+v`; `enter` on a paste marker, or a double click on it, previews it; `ctrl+s` stashes a draft and asks before it replaces a held one. |
| `chrome.ts` | One-line header with the skills and MCP server counts on the right; the footer shows the folder, branch, Pi's own token and context stats and the token rate, and its key hints follow what Pi is doing. |

## Recommended settings

In `~/.pi/agent/settings.json`:

```json
{
  "hideThinkingBlock": true,
  "quietStartup": "header",
  "markdown": { "mermaid": "off" },
  "fullscreenScrollbar": "always"
}
```

- `hideThinkingBlock` starts thinking folded; without it, every block opens expanded.
- `quietStartup` hides the `[Extensions]` / `[Skills]` listing that extensions cannot hide.
- `markdown.mermaid: "off"` hands Mermaid diagrams to `mermaid.ts`; otherwise Pi replaces the source with its own
  drawing before pi-tune sees it.
- `fullscreenScrollbar: "always"` reserves the right-hand column that the timeline draws over, so it never covers
  text.

The timeline and pinned prompt rely on Pi 1.4 internals. If a Pi update changes them, those features turn themselves
off with a warning instead of misbehaving.

## Terminal notes

- On macOS, `alt+o` (like Pi's own `alt+enter`) needs the option key to send meta: in Ghostty set
  `macos-option-as-alt = true`, in Zed set `"terminal": { "option_as_meta": true }`. `/view` works either way.
- Zed shows the terminal title in its breadcrumb bar only, not on the tab.

## Develop

See `AGENTS.md` for the layout, commands and rules, and `test/e2e/README.md` for the end-to-end harness.
