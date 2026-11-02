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

## Develop

See `AGENTS.md` for the layout, commands and rules, and `test/e2e/README.md` for the end-to-end harness.
