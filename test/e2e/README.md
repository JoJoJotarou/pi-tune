# E2E harness

Runs a real Pi in a pseudo-terminal (node-pty) against a scripted model and checks the rendered screen
(@xterm/headless). Screenshots are optional PNGs rendered by headless Chrome.

## Write a scenario

A scenario drives model calls in order. A turn with a tool block stops with `stopReason: "toolUse"`.

```ts
import { startPi, type Scenario } from "./harness.ts";

const scenario: Scenario = {
  files: { "README.md": "# demo\n" }, // created in the temp project dir
  turns: [
    [{ thinking: "run it" }, { tool: "bash", args: { command: "seq 1 3" } }],
    [{ text: "done" }],
  ],
};
const pi = await startPi({ scenario, tune: true }); // tune: false = Pi without pi-tune
try {
  pi.type("run it\r"); // "\r" is Enter
  await pi.waitFor("done");
  const rows = pi.screen(); // visible rows
} finally {
  await pi.close();
}
```

`press`, `paste`, `click`, `clickText`, `move` (pointer motion for hover), and `wheel` drive the keyboard and mouse. `waitFor`/`waitForGone` default to
20 s and throw with a screen dump on timeout. `shot(name)` is a no-op unless `PI_TUNE_SHOTS` is set.

`extensions: ["broken.ts"]` loads extra extension files with `-e` after the pi-tune package. Relative paths
resolve against the scenario's project dir, so `files` can ship the extension; `tune: false` plus an absolute
path loads one pi-tune extension alone.

## Run

```sh
npm run e2e                                      # all e2e tests, 4 scenarios at a time
PI_TUNE_SHOTS=shots npm run e2e                  # also write shots/<name>.png
npm run e2e -- test/e2e/tools.test.ts            # one area
npm run e2e -- --test-name-pattern="edit results" # one test
```

## Speed

Scenarios spawn a real Pi each, so keep the loop tight:

1. Unit tests (`npm test`, seconds) cover the pure renderers — run them first.
2. Run the one e2e file for the area you touched.
3. Full `npm run e2e` before opening a PR; `npm run ci` does not include it.

Scenarios must not pad with fixed sleeps: wait for the observable state (`waitFor`, `waitForRow`,
`waitForShift`) instead, and keep slow streaming (`tokensPerSecond`) only where a test asserts it.

Chrome comes from `CHROME_PATH`, else `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
