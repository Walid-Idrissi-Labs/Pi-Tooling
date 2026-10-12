# Pi-Tooling

Extensions for the [Pi coding agent](https://pi.dev). Each one lives in its own folder and can be used alone.

| Tool | What it does |
|---|---|
| [pi-todo](pi-todo/) | A checklist the agent follows and you watch. It cannot stop while items are open, and a tick means the item's check passed. |
| [pi-shoulder-tap](pi-shoulder-tap/) | A desktop notification when Pi needs you, and only then. |
| [pi-btw](pi-btw/) | Side questions: ask while the agent works, without interrupting or polluting the main conversation. |

## Install

All of them, from a clone or straight from GitHub:

```bash
pi install /path/to/Pi-Tooling
pi install git:github.com/Walid-Idrissi-Labs/Pi-Tooling
```

Or one tool:

```bash
pi install /path/to/Pi-Tooling/pi-btw
```

Install the whole folder or single tools, not both: Pi would load a tool twice. With the whole folder installed, `pi config` switches individual tools off.

## Tests

```bash
npm test
```

This runs every tool's tests. They drive the real `pi` binary with a scripted model, offline and at no model cost; the helpers are in `testkit/`. The tests that need the terminal UI run inside a private tmux server and are skipped when tmux is not installed.
