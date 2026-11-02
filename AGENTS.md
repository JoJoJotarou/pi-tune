# pi-tune

A Pi package that tunes Pi's interactive TUI: denser transcript, better tool and Markdown rendering, navigation,
input box and status line. Extensions only. Built and tested against Pi 1.4.0.

## Layout

- `extensions/<area>.ts`: one Pi extension per screen area (`tools`, `thinking`, `navigation`, `viewer`,
  `markdown`, `status`, `editor`, `chrome`). Wiring only: register renderers, events, shortcuts, and commands,
  then call into `src/<area>/`. An area must keep working when any other area is disabled in `pi config`.
- `src/<area>/`: the logic. Prefer pure functions (`(input, width, theme) => string[]`) so they can be unit
  tested. Tests sit next to the code: `diff.ts` and `diff.test.ts`.
- `src/shared/`: helpers used by two or more areas. Put a helper here only once a second area needs it.
- `src/internals/`: the only place that may touch Pi internals the API does not declare (private fields, class
  names, runtime-only methods). Each function checks at runtime that the shape it relies on is there. If the
  check fails, it reports that failure to the caller, and the caller disables the feature with one
  `ctx.ui.notify(…, "warning")`. Never fail silently.
- `test/theme.ts`: `testTheme("dark" | "light")` returns a real Pi `Theme` for unit tests.
- `test/e2e/`: real Pi in a pseudo-terminal, driven by a scripted model. See `test/e2e/README.md`. Acceptance
  screenshots: `PI_TUNE_SHOTS=<dir> npm run e2e`.

## Commands

```sh
npm run fix        # format and apply safe lint fixes (Biome)
npm run lint
npm run typecheck
npm test           # unit tests: node --test "src/**/*.test.ts"
npm run smoke      # loads the package in Pi (rpc mode) and fails on any extension error
npm run e2e        # real Pi in a pseudo-terminal (needs rg and fd for the grep and find tools)
npm run ci         # lint + typecheck + test + smoke
```

## TypeScript

- Node runs the `.ts` files directly through type stripping, so only erasable syntax is allowed: no `enum`, no
  `namespace`, no constructor parameter properties. Relative imports end in `.ts`. Use `import type` for types.
- Import `@earendil-works/*` as peers. Pi supplies its own copies at runtime, so never bundle them.

## Pi API: where to look

- Docs: `node_modules/@earendil-works/pi-coding-agent/docs/*.md`. Start with `extensions.md` and `tui.md`.
- Examples: `node_modules/@earendil-works/pi-coding-agent/examples/extensions/*.ts`.
- Types: the `*.d.ts` files under `node_modules/@earendil-works/*/dist/`.
- Do not read the compiled `.js` under `node_modules`. To learn how something behaves at runtime, write a small
  test and run it.

## Rendering rules

- No rendered line may be wider than the width it was given. Measure with `visibleWidth`, and cut with
  `truncateToWidth` or `sliceByColumn` from `@earendil-works/pi-tui`. In regular mode, an over-wide line crashes
  Pi. Test at width 40 as well as at normal widths.
- Take colors from the `Theme` you are handed (`theme.fg`, `theme.bg`, `theme.style`, `theme.colors`). Never
  hard-code ANSI colors.
- All TUI text is English, short, and uses the exact strings given in the task spec. Issue mockups that show
  Chinese UI text are to be read as their English equivalents.
- Do not add a setting unless the issue asks for one.
