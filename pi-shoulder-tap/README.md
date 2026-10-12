# pi-shoulder-tap

A desktop notification when the [Pi coding agent](https://pi.dev) needs you, and only then.

## Use it

```bash
pi -e /path/to/pi-shoulder-tap         # this session only
pi install /path/to/pi-shoulder-tap    # every session
```

Then run `/shoulder-tap` once: it sends a test notification after 5 seconds, so you can switch to another window and see what your terminal does with it.

## When it taps

| Moment | Notification |
|---|---|
| A run settles | `π <project>: done`, with the agent's last words as the message |
| The agent opens a dialog and waits (a question, a permission prompt) | `π <project>: asking`, with the dialog's title |
| Another extension asks for it | Whatever that extension sends |

It stays quiet:

- **while you are looking at the terminal.** In fullscreen mode (Pi's default) the terminal reports when its window gains or loses focus, so this is exact. Without those reports, input in the last 30 seconds counts as being there.
- **when you pressed Escape.** You stopped the run, so you know.
- **when a tap already explained the stop.** If another extension tapped as the run ended, the generic "done" is skipped.
- **in subagent sessions.** A subagent reports to the agent that started it.

## How it reaches you

It writes the terminal's own notification sequence (OSC 777) followed by a bell. The terminal shows the banner, and clicking it brings you back to the right window. In Ghostty the bell also bounces the dock icon and puts a 🔔 on the tab until you return; sound stays off unless you enabled it in `bell-features`.

## Asking for a tap from another extension

```ts
pi.events.emit("shoulder-tap", { title: "todo blocked", body: "#3 Deploy: needs VPN access" });
```

`body` is required and `title` is optional. Nothing happens when pi-shoulder-tap is not installed, so emitting is always safe. pi-todo does this when an item is blocked and when it lets the agent stop with items still open.

## Limits

- OSC 777 only: Ghostty, iTerm2, WezTerm. Kitty and Windows Terminal use other sequences; Pi's bundled `notify.ts` example has both.
- Inside tmux, notifications need `set -g allow-passthrough on`, and exact focus tracking needs `set -g focus-events on`.
- It only works in the terminal UI. In print, JSON and RPC modes it does nothing.

## Tests

```bash
npm test
```

`test/core.test.ts` covers the decision logic and the bytes sent. `test/e2e.test.ts` drives the real Pi terminal UI inside a private tmux server with a scripted model, simulates the window losing and regaining focus, and reads the notification bytes Pi writes. It is skipped when tmux is not installed.
