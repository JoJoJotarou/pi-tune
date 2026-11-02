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

`press`, `paste`, `click`, and `clickText` drive the keyboard and mouse. `waitFor`/`waitForGone` default to
20 s and throw with a screen dump on timeout. `shot(name)` is a no-op unless `PI_TUNE_SHOTS` is set.

`extensions: ["broken.ts"]` loads extra extension files with `-e` after the pi-tune package. Relative paths
resolve against the scenario's project dir, so `files` can ship the extension; `tune: false` plus an absolute
path loads one pi-tune extension alone.

## Run

```sh
npm run e2e                                      # all e2e tests
PI_TUNE_SHOTS=shots npm run e2e                  # also write shots/<name>.png
```

Chrome comes from `CHROME_PATH`, else `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
