# pi-explorer

A file tree of the folder the [Pi coding agent](https://pi.dev) runs in: docked beside the conversation, and clickable.

## Use it

```bash
pi -e /path/to/pi-explorer         # this session only
pi install /path/to/pi-explorer    # every session
```

```text
/explorer          show or hide the panel
/explorer focus    move the keyboard into it (also Ctrl+Shift+E)
```

| | Mouse | Keyboard |
|---|---|---|
| Open or close a folder | Click it | `→` and `←` |
| Put `@path` in the prompt | Click a file | `Enter` on a file |
| Move through the tree | Wheel | `↑` and `↓` |
| Leave | `×` closes the panel | `Esc` goes back to the prompt |

## How it works

- **Beside the conversation, not over it.** In fullscreen mode the panel takes 32 columns on the right and the conversation narrows to make room. No tmux is involved.
- **In front where it cannot dock.** In regular mode, or in a terminal under 80 columns, it opens over the conversation with the keyboard in it, and closes when you pick a file.
- **Follows the disk.** A file the agent creates or deletes shows up as it happens.
- **Stays as you left it.** Open folders are remembered while Pi runs, and a docked panel comes back after `/new`, `/resume` and `/reload`.
- **Lists everything but `.git`.** Ignored folders such as `node_modules` are there too. That costs nothing until you open one.
- **Does no work it can avoid.** A folder is read only when you open it, and off the UI thread. Only open folders are watched, by the system's own file notifications: there is no polling. A redraw builds only the rows on screen, so a folder of 20,000 files scrolls like one of 20. Closed, the panel runs nothing.

## Limits

- A docked column makes each frame Pi draws dearer, because Pi's renderer then builds every screen row from two parts. In a 200×60 window, scrolling a 2,000-line conversation, a frame took 6.5 ms without the panel and 9.5 to 11 ms with it. Nothing is drawn while nothing changes.
- Docking reads the root of Pi's layout, which Pi lets an extension set but not read. If a later Pi changes that, the panel still opens, in front.
- In regular mode Pi leaves the mouse to the terminal, so the panel is keyboard only there.
- A link to a folder is listed as a file.
- It shows names only: no git status, no file preview.

## Tests

```bash
npm test
```

`test/core.test.ts` covers the tree: ordering, the visible rows, scrolling and what is drawn. `test/e2e.test.ts` runs the real `pi` binary inside a private tmux server and drives the panel with typed keys and with the byte sequences a mouse sends: docking, clicks, the wheel, a new file on disk, a new session, a reload, the panel in front on a narrow terminal, and the keyboard-only panel of regular mode. It is skipped when tmux is not installed.
