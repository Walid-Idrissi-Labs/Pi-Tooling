# pi-recap

A short, factual receipt of what the [Pi coding agent](https://pi.dev) did while you were not watching.

## Use it

```bash
pi -e /path/to/pi-recap         # this session only
pi install /path/to/pi-recap    # every session
```

## What you get

When a run with enough activity ends, this is added to the transcript:

```text
recap · 12m40s · 52 tool calls
changed  src/auth.ts ×4
         src/auth.test.ts
         README.md
ran      14 commands, 2 failed
failing  npm run lint
todos    5/6 done
blocked  Deploy to staging: needs VPN access
asked    Deploy now?
tools    read 22 · bash 14 · edit 9 · pi_todo 7
```

| Line | Meaning |
|---|---|
| `changed` | Files the agent edited or wrote, with how many times |
| `ran` | Shell commands it ran, and how many failed |
| `failing` | Commands whose last run failed: what was still broken when it stopped |
| `todos` | The checklist as [pi-todo](../pi-todo/) left it, when it was used |
| `blocked` | Its blocked items, with the reason for each |
| `asked` | Dialogs the agent opened |
| `tools` | Its tool calls, most used first |

A line only appears when it has something to say. Lists go one entry per line, five at most, and `Ctrl+O` shows the rest.

## How it works

- **Facts, not a summary.** It is built from the tool events themselves, with no model call. It costs nothing and cannot gloss over a failure.
- **Only when there is something to digest.** A run needs at least 5 tool calls to get a recap; shorter ones are quicker to read directly.
- **The agent never sees it.** It is stored as a session entry Pi does not send to the model, so it costs no context.
- **`/recap` at any time** shows the same for the run in progress, or for the last one.

## Limits

- Files changed by a shell command are not listed, only those changed with the edit and write tools.
- A command counts as fixed when the exact same command later passes.
- Commands a tool runs itself, such as pi-todo's checks, are not counted.

## Tests

```bash
npm test
```

`test/core.test.ts` covers how events become a recap. `test/e2e.test.ts` runs the real `pi` binary with a scripted model: headless to check what is recorded, and inside a private tmux server to check how it appears. The tmux test is skipped when tmux is not installed.
