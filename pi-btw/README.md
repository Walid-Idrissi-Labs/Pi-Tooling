# pi-btw

Side questions for the [Pi coding agent](https://pi.dev): ask while it works, without interrupting or polluting the main conversation.

## Use it

```bash
pi -e /path/to/pi-btw         # this session only
pi install /path/to/pi-btw    # every session
```

```text
/btw why did it pick that library?
/btw and what would the alternative cost?
/btw
/btw history
```

## How it works

- **It works while the agent is busy.** The question runs at once, next to the main run.
- **It already knows your work.** The same model answers, with the main conversation as read-only context (the compacted one, if the session was compacted).
- **Nothing leaks.** The question and the answer are never sent to the main agent, so they cost it no context.
- **Follow-ups work.** Earlier side questions are replayed with each new one. `/btw` alone shows the last answer again.
- **History.** `/btw history` lists every side question of the session, newest first. Pick one to read its answer again; Escape goes back to the list. Exchanges are kept in the session file as entries Pi never sends to the model, so the history survives `/reload` and resuming the session, and follows the branch you are on.
- **No tools.** A side question cannot edit a file or run a command. If the answer is not in the conversation, it says what is missing.
- **Escape closes the panel only.** It cancels the side question if it is still answering, and never interrupts the agent.

The answer appears in a panel that takes the editor's place, at most half the terminal high, while the transcript above keeps moving. `↑` `↓` `PgUp` `PgDn` scroll a long answer.

## Limits

- Side questions are stored in the session file. If you export or share a session, they go with it.
- Each question sends the conversation again as text, with no prompt-cache hit. On a metered API, a side question in a long session costs about one full read of the context.
- Its tokens are not counted in the session's usage totals.
- Outside the terminal UI there is no panel: in RPC mode the answer arrives as a notification.

## Tests

```bash
npm test
```

`test/core.test.ts` covers what is sent to the model. `test/e2e.test.ts` runs the real `pi` binary with a scripted model: headless to check what each request carried, and inside a private tmux server to ask while the agent is busy and close the panel with Escape. The tmux tests are skipped when tmux is not installed.
