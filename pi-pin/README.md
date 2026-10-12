# pi-pin

Instructions the [Pi coding agent](https://pi.dev) cannot forget: pinned for the session, in every request, visible to you.

## Use it

```bash
pi -e /path/to/pi-pin         # this session only
pi install /path/to/pi-pin    # every session
```

```text
/pin use pnpm, never npm
/pin do not touch the migrations folder
/pin
/pin clear
```

## How it works

- **In every request.** Pinned instructions open each request the model receives. They are not part of the conversation, so compaction cannot drop them.
- **Noticed at once.** When you add, edit or clear a pin, also in the middle of a run, the next request ends with a one-time note saying what changed.
- **Visible to you.** The pins are listed below the editor, one per line, so a forgotten pin does not quietly steer the agent. The list takes at most three lines: further pins flow into more columns, so they all stay on screen.
- **Yours to manage.** `/pin` alone opens the pins as text, one per line: edit, reorder, or delete a line to unpin. The agent has no tool to change them.
- **Cheap.** The block is identical on every request, so it stays in the prompt cache.
- **Kept with the session.** Pins survive `/reload` and resuming, and follow the branch you are on.

## Limits

- A pin is an instruction, not a guard: nothing stops the agent from breaking one. For rules that must hold, use an extension that blocks the tool call, such as Pi's bundled `protected-paths.ts`.
- Pins sit at the start of the context. Nothing repeats them later in a long conversation, except the note after a change.
- Subagents do not inherit them.
- They belong to one session. Rules for every session go in `AGENTS.md`.

## Tests

```bash
npm test
```

`test/core.test.ts` covers the texts built from the pins. `test/e2e.test.ts` runs the real `pi` binary with a scripted model: headless to check what each request carries, including after compaction and on resume, and inside a private tmux server for the strip and the editor. The tmux test is skipped when tmux is not installed.
