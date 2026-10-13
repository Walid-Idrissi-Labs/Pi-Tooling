/**
 * pi-explorer - a file tree of the folder Pi runs in, beside the conversation.
 *
 * `/explorer` shows or hides it. In fullscreen mode it docks as a column on the right and the
 * conversation narrows to make room; folders, files and the close button answer to clicks and
 * the wheel scrolls. Where it cannot dock, it opens as a panel in front instead. Picking a file
 * puts a reference to it in the prompt.
 *
 * It is built to cost nothing it does not have to. A folder is read only when it is opened, and
 * off the UI thread. Only open folders are watched, and only for names that come or go. A redraw
 * builds just the rows on screen, and nothing at all when the panel has not changed.
 */

import { type FSWatcher, watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, HStack, isViewportTUI, matchesKey, type TUI, type TuiMouseEvent, type TuiMouseEventResult, truncateToWidth } from "@earendil-works/pi-tui";
import { CLOSE, clamp, type Entry, entries, HEADER, mention, parentRow, reveal, rows, same, type Tree, view } from "./core.ts";

const NAME = "pi-explorer";
/** Columns the panel takes. */
const WIDTH = 32;
/** A narrower terminal gets the panel in front: docked, it would squeeze the conversation. */
const MIN_DOCK_COLUMNS = 80;
/** Folder changes are gathered this long before one re-read, so a burst of new files costs one. */
const SETTLE_MS = 100;

/** What outlives a session switch and a /reload in one Pi process: whether the panel is docked, and its open folders. */
interface Kept {
	docked: boolean;
	open: Set<string>;
}
const KEPT = Symbol.for(NAME);
// Pi runs this file again on /reload and its function again on every new session, so neither can hold this.
const kept = ((globalThis as { [KEPT]?: Kept })[KEPT] ??= { docked: false, open: new Set() });

interface Actions {
	/** A file was chosen. */
	pick(path: string): void;
	/** The keyboard goes back to where it was. */
	leave(): void;
	close(): void;
}

class Panel implements Component, Focusable {
	private readonly tree: Tree;
	private readonly title: string;
	/** The visible rows, rebuilt only after the tree changed. */
	private list: Entry[] | undefined;
	private offset = 0;
	private cursor = 0;
	/** The path the cursor was on when the rows were dropped: the cursor goes back to that entry, wherever it now is. */
	private held: string | undefined;
	private hasKeyboard = false;
	/** Bumped on every change to what is drawn, so an unchanged panel is served from `frame`. */
	private version = 0;
	private frame: { key: string; lines: string[] } | undefined;
	private readonly watchers = new Map<string, FSWatcher>();
	private readonly stale = new Set<string>();
	private timer: ReturnType<typeof setTimeout> | undefined;
	private disposed = false;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly root: string,
		open: Set<string>,
		private readonly actions: Actions,
	) {
		this.tree = { children: new Map(), open };
		this.title = basename(root) || root;
		void this.load("");
	}

	/** Set by Pi when the keyboard moves in or out. */
	get focused() {
		return this.hasKeyboard;
	}
	set focused(value: boolean) {
		this.hasKeyboard = value;
		this.tui.requestRender();
	}

	private room() {
		return Math.max(1, this.tui.terminal.rows - HEADER);
	}

	/** Shown now: the root, or an open folder whose parents are all open. */
	private live(dir: string): boolean {
		return !dir || (this.tree.open.has(dir) && this.live(dir.slice(0, Math.max(0, dir.lastIndexOf("/")))));
	}

	/** Reads one folder off the UI thread, then the open folders inside it that are not yet watched. */
	private async load(dir: string) {
		// A folder that cannot be read shows as empty.
		const found = await readdir(join(this.root, dir), { withFileTypes: true }).catch(() => []);
		// Closed while the read was under way: nothing to show, nothing to watch.
		if (this.disposed || !this.live(dir)) return;
		// shortcut: a link to a folder is listed as a file, which rules out loops; follow links with stat() if they need opening.
		const next = entries(dir, found.map((item) => ({ name: item.name, dir: item.isDirectory() })));
		this.watch(dir);
		if (!same(this.tree.children.get(dir), next)) {
			this.tree.children.set(dir, next);
			this.changed();
		}
		for (const entry of next) if (entry.dir && this.tree.open.has(entry.path) && !this.watchers.has(entry.path)) void this.load(entry.path);
	}

	/** One watcher per folder on screen. Only names coming and going matter: a file's content changing shows nothing new. */
	private watch(dir: string) {
		if (this.watchers.has(dir)) return;
		try {
			const watcher = watch(join(this.root, dir), { persistent: false }, (event) => {
				if (event !== "rename") return;
				this.stale.add(dir);
				this.timer ??= setTimeout(() => this.refresh(), SETTLE_MS).unref();
			});
			// A watched folder that is deleted reports an error, and an unheard error would take Pi down.
			watcher.on("error", () => this.unwatch(dir));
			this.watchers.set(dir, watcher);
		} catch {
			// shortcut: a folder that cannot be watched (already gone, or no file handles left) stays as read until its parent changes; poll it if that ever matters.
		}
	}

	private unwatch(dir: string) {
		this.watchers.get(dir)?.close();
		this.watchers.delete(dir);
	}

	private refresh() {
		this.timer = undefined;
		for (const dir of this.stale) if (this.watchers.has(dir)) void this.load(dir);
		this.stale.clear();
	}

	private changed() {
		this.held ??= this.list?.[this.cursor]?.path;
		this.list = undefined;
		this.version++;
		this.tui.requestRender();
	}

	private rows(): Entry[] {
		if (this.list) return this.list;
		this.list = rows(this.tree);
		// Folders that went out of view need no watching.
		const shown = new Set<string>();
		for (const entry of this.list) if (entry.dir && this.tree.open.has(entry.path)) shown.add(entry.path);
		for (const dir of this.watchers.keys()) if (dir && !shown.has(dir)) this.unwatch(dir);
		// A file that appears above the cursor must not slide another entry under it.
		const at = this.held === undefined ? -1 : this.list.findIndex((entry) => entry.path === this.held);
		if (at >= 0) this.cursor = at;
		this.held = undefined;
		return this.list;
	}

	private toggle(entry: Entry) {
		// A closed folder keeps what it showed, so it reopens at once and is corrected by the fresh read.
		if (this.tree.open.delete(entry.path)) return this.changed();
		this.tree.open.add(entry.path);
		this.changed();
		void this.load(entry.path);
	}

	private activate(n: number) {
		const entry = this.rows()[n];
		if (!entry) return;
		this.cursor = n;
		if (entry.dir) return this.toggle(entry);
		this.actions.pick(entry.path);
		// Picked from the keyboard: the next thing typed belongs in the prompt.
		if (this.hasKeyboard) this.actions.leave();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel") {
			const before = this.offset;
			this.offset = clamp(this.offset + (event.wheelDelta ?? 0), this.rows().length, this.room());
			return { handled: true, render: this.offset !== before };
		}
		// Claiming the press is what makes Pi send the click here, and keeps it from starting a text selection.
		if (event.type === "press") return { handled: true, render: false };
		if (event.type !== "click" || event.button !== "left") return undefined;
		const row = this.offset + event.y - HEADER;
		if (event.y < HEADER) {
			if (event.x >= event.width - CLOSE) this.actions.close();
		} else if ((event.clickCount ?? 1) === 1 || this.rows()[row]?.dir) {
			// A double click still picks a file only once.
			this.activate(row);
		}
		return { handled: true };
	}

	handleInput(data: string) {
		const list = this.rows();
		const entry = list[this.cursor];
		const isOpen = entry?.dir && this.tree.open.has(entry.path);
		// ctrl+c too: Pi's own handling of it lives in the prompt, which does not have the keyboard here.
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) return this.actions.leave();
		if (matchesKey(data, "enter")) return this.activate(this.cursor);
		if (matchesKey(data, "up")) this.cursor--;
		else if (matchesKey(data, "down")) this.cursor++;
		else if (matchesKey(data, "right") && entry?.dir) {
			if (!isOpen) this.toggle(entry);
			else if ((list[this.cursor + 1]?.depth ?? 0) > entry.depth) this.cursor++;
		} else if (matchesKey(data, "left") && entry) {
			if (isOpen) this.toggle(entry);
			else this.cursor = parentRow(list, this.cursor);
		} else return;
		this.cursor = Math.max(0, Math.min(this.cursor, list.length - 1));
		this.offset = reveal(this.offset, this.cursor, this.room());
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const list = this.rows();
		const height = this.tui.terminal.rows;
		this.cursor = Math.max(0, Math.min(this.cursor, list.length - 1));
		this.offset = clamp(this.offset, list.length, this.room());
		const key = `${width} ${height} ${this.offset} ${this.cursor} ${this.hasKeyboard} ${this.version}`;
		if (this.frame?.key !== key) {
			const cursor = this.hasKeyboard ? this.cursor : undefined;
			const lines = view({ title: this.title, rows: list, open: this.tree.open, offset: this.offset, cursor }, width, height, this.theme, (text, columns, pad) => truncateToWidth(text, columns, "…", pad));
			this.frame = { key, lines };
		}
		return this.frame.lines;
	}

	invalidate() {
		this.version++;
	}

	dispose() {
		this.disposed = true;
		clearTimeout(this.timer);
		for (const watcher of this.watchers.values()) watcher.close();
		this.watchers.clear();
	}
}

/** A widget that draws nothing. */
const NOTHING: Component = { render: () => [], invalidate() {} };

export default function (pi: ExtensionAPI) {
	let panel: Panel | undefined;
	/** Takes the panel off the screen, whichever way it was put up. */
	let hide: (() => void) | undefined;
	/** Docked only: moves the keyboard into the tree. */
	let focus: (() => void) | undefined;

	const actions = (ctx: ExtensionContext, leave: () => void): Actions => ({
		pick: (path) => ctx.ui.pasteToEditor(mention(path)),
		leave,
		close: () => {
			kept.docked = false;
			hide?.();
		},
	});

	/** Puts the panel beside the conversation. False where Pi's renderer cannot give it a column. */
	const dock = (ctx: ExtensionContext): boolean => {
		ctx.ui.setWidget(
			NAME,
			// A widget is how Pi hands an extension its renderer outside a dialog. This one draws
			// nothing: it ties the panel's life to Pi's, which disposes widgets on /reload and on a
			// session switch.
			(tui, theme) => {
				if (!isViewportTUI(tui) || tui.terminal.columns < MIN_DOCK_COLUMNS) return NOTHING;
				// The one unofficial step: Pi's renderer lets its layout root be set, but not read.
				const reach = tui as unknown as { layoutRoot?: Component; getFocusedComponent?(): Component | null };
				const root = reach.layoutRoot;
				if (!root) return NOTHING;

				let before: Component | null = null;
				const made = new Panel(tui, theme, ctx.cwd, kept.open, actions(ctx, () => tui.setFocus(before)));
				const split = new HStack([
					{ component: root, basis: 0, grow: 1 },
					{ component: made, basis: WIDTH, shrink: 0, visible: (viewport) => viewport.width >= MIN_DOCK_COLUMNS },
				]);
				// Pi's renderer skips the mouse handler of its own stacks, but cannot tell this one is a
				// stack too, and that handler would treat the two columns as rows.
				split.handleMouse = () => undefined;
				tui.setLayoutRoot(split);

				panel = made;
				hide = () => ctx.ui.setWidget(NAME, undefined);
				focus = () => {
					if (made.focused) return;
					// Without a way back to the prompt, the keyboard stays where it is.
					before = reach.getFocusedComponent?.() ?? null;
					if (before) tui.setFocus(made);
				};
				return {
					render: () => [],
					invalidate() {},
					dispose() {
						if (made.focused) tui.setFocus(before);
						if (reach.layoutRoot === split) tui.setLayoutRoot(root);
						made.dispose();
						panel = hide = focus = undefined;
					},
				};
			},
			{ placement: "belowEditor" },
		);
		if (!panel) ctx.ui.setWidget(NAME, undefined);
		return panel !== undefined;
	};

	/** The panel in front of the conversation, with the keyboard, until a file is picked or it is closed. */
	const float = (ctx: ExtensionContext) =>
		ctx.ui
			.custom<void>(
				(tui, theme, _keybindings, done) => {
					hide = done;
					panel = new Panel(tui, theme, ctx.cwd, kept.open, actions(ctx, done));
					return panel;
				},
				{ overlay: true, overlayOptions: { anchor: "top-right", width: WIDTH, maxHeight: "100%" } },
			)
			.finally(() => {
				panel = hide = undefined;
			});

	const show = async (ctx: ExtensionContext, withKeyboard: boolean) => {
		if (ctx.mode !== "tui") return ctx.hasUI ? ctx.ui.notify("The file panel needs Pi's terminal UI.", "info") : undefined;
		if (!panel && dock(ctx)) kept.docked = true;
		if (!panel) return float(ctx);
		if (withKeyboard) focus?.();
	};

	pi.on("session_start", (_event, ctx) => {
		if (kept.docked && ctx.mode === "tui") dock(ctx);
	});
	// Pi takes a panel in front down without disposing it, which would leave its folder watchers open.
	pi.on("session_shutdown", () => panel?.dispose());

	pi.registerCommand("explorer", {
		description: "Show or hide the file panel. focus: move the keyboard into it",
		// Nothing once the word is complete: an open suggestion would make Enter accept it instead of running the command.
		getArgumentCompletions: (prefix) => (prefix && prefix !== "focus" && "focus".startsWith(prefix) ? [{ value: "focus", label: "focus" }] : null),
		handler: async (args, ctx) => {
			if (args.trim() === "focus") return show(ctx, true);
			if (!panel) return show(ctx, false);
			kept.docked = false;
			hide?.();
		},
	});

	pi.registerShortcut("ctrl+shift+e", {
		description: "Move the keyboard into the file panel",
		handler: (ctx) => show(ctx, true),
	});
}
