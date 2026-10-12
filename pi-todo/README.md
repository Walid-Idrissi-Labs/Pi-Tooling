# pi-todo

A checklist for the [Pi coding agent](https://pi.dev). The agent plans its work as a list you can watch, cannot stop while workable items remain, and can only tick an item once it is verified.

## Use it

```bash
pi -e /path/to/pi-todo         # this session only
pi install /path/to/pi-todo    # every session
```

Then ask for multi-step work as usual. The agent gets a `pi_todo` tool and is told to plan with it.

## What you see

A panel above the editor, one line per item, and a `☑ 3/7` counter in the footer.

| Mark | Meaning |
|---|---|
| `✔` green | Done, and the item's check command passed |
| `✓` grey | Done on a written note only (the agent's word, or your own tick) |
| `▸` | In progress, with the time spent on it in the current run. Its check command is on the line below |
| `◻` | Pending |
| `⊘` | Blocked. The reason is on the line below |
| `✗` | Dropped. The reason is on the line below |

A long list is windowed around the item being worked on. The header then shows one square per item, so none is lost from view.

## How it works

- **A tick means verified.** An item can carry a check command. On `done`, the extension runs that command itself, through Pi's bash tool, and refuses the tick unless it exits 0. An item without a check needs a note saying what was verified.
- **The agent cannot stop early.** When it tries to end with pending or in-progress items, it is sent back to work with the list of what is left. It is let go when nothing workable remains, when you press Escape, or after three reminders in a row without a newly closed item (one reminder if an item is blocked).
- **Two honest exits.** The agent can `block` an item (it needs you) or `drop` it (no longer needed). Both require a reason, which you see in the panel.
- **Final sweep.** When the last item closes, every check command runs once more. A check that no longer passes reopens its items. The agent is then asked whether the list covered your original request.
- **Reminders.** The agent is shown the list again after you edit it, after compaction, and after ten requests without touching it. These ride on one request and are never stored.
- **A tap when you are needed.** When an item is blocked, and when the agent is let go with items still open, pi-todo emits a `shoulder-tap` event. With [pi-shoulder-tap](../pi-shoulder-tap/) installed that becomes a desktop notification; without it nothing happens.
- **No files.** State lives in the session, so it follows `/reload`, resume, compaction and branch navigation. A finished list leaves the screen when your next prompt starts.

## Your side

| Command | Effect |
|---|---|
| `/pi-todo` | Edit the whole list as text |
| `/pi-todo add <text>` | Append an item |
| `/pi-todo clear` | Empty the list |
| `/pi-todo auto` | Switch keep-going off or on for this session |

In the editor, each item is one line. Reorder or delete lines, type a new line to add an item, and change the box to change the status:

```text
[x] #1 Read the auth module
    note: looked at src/auth.ts
[>] #2 Add token refresh
    check: npm test -- auth
[ ] #3 Update docs
[!] #4 Deploy to staging
    note: needs VPN access
```

`[ ]` pending, `[>]` in progress, `[x]` done, `[!]` blocked, `[-]` dropped. Keep the `#id` so an item keeps its history.

## Limits

- The agent writes the check commands, so a lazy one such as `true` would pass. The panel shows the command of the item being worked on, and `/pi-todo` shows them all, so you can spot it.
- Every check command has the same 10-minute timeout (`CHECK_TIMEOUT_S` in `index.ts`).
- The tool is named `pi_todo`, not `todo`: Pi keeps only the first tool registered under a name, and other todo extensions use that one.
- The agent gets one todo list. At session start, pi-todo hides any other extension's `todo` tool from the model and says so in a notice. With two, the model picks by your wording, and the other tool's own "use me for todos" rule tends to win. That extension's commands keep working; remove it with `pi remove <source>` if you no longer use it.

## Tests

```bash
npm test
```

`test/core.test.ts` covers the list logic. `test/e2e.test.ts` runs the real `pi` binary with a scripted model (`test/faux.ts`), offline and at no model cost.
