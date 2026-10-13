/**
 * pi-explorer core: the file tree's state, its visible rows and how they are drawn.
 * No Pi imports and no disk access, so it runs under plain `node --test`.
 */

export interface Entry {
	name: string;
	/** Path from the root folder, with "/" between the parts. */
	path: string;
	depth: number;
	dir: boolean;
}

/** What is known of the tree. The root folder is "". */
export interface Tree {
	/** The folders read so far, each with its entries in display order. */
	children: Map<string, Entry[]>;
	/** The folders shown open. */
	open: Set<string>;
}

/** Never worth a row: git's own store and Finder's droppings. */
const HIDDEN = new Set([".git", ".DS_Store"]);

// One shared collator: localeCompare would build a new one for every comparison.
const order = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** A folder's entries as shown: folders first, then files, each in natural order ("a2" before "a10"). */
export function entries(parent: string, found: readonly { name: string; dir: boolean }[]): Entry[] {
	const depth = parent ? parent.split("/").length : 0;
	return found
		.filter((item) => !HIDDEN.has(item.name))
		.map((item) => ({ name: item.name, path: parent ? `${parent}/${item.name}` : item.name, depth, dir: item.dir }))
		.sort((a, b) => Number(b.dir) - Number(a.dir) || order.compare(a.name, b.name) || (a.name < b.name ? -1 : 1));
}

/** Whether a fresh read shows the same entries, so nothing needs redrawing. */
export const same = (before: readonly Entry[] | undefined, after: readonly Entry[]) =>
	before?.length === after.length && before.every((entry, n) => entry.name === after[n].name && entry.dir === after[n].dir);

/** The rows on screen, top to bottom: every entry whose parent folders are all open. */
export function rows(tree: Tree): Entry[] {
	const out: Entry[] = [];
	const walk = (dir: string) => {
		for (const entry of tree.children.get(dir) ?? []) {
			out.push(entry);
			if (entry.dir && tree.open.has(entry.path)) walk(entry.path);
		}
	};
	walk("");
	return out;
}

/** The row of the folder that holds row `n`, or `n` itself at the top level. */
export function parentRow(list: readonly Entry[], n: number): number {
	for (let i = n - 1; i >= 0; i--) if (list[i].depth < list[n].depth) return i;
	return n;
}

/** The first shown row, kept within what exists. */
export const clamp = (offset: number, total: number, room: number) => Math.max(0, Math.min(offset, total - room));

/** The first shown row that keeps row `cursor` in view. */
export const reveal = (offset: number, cursor: number, room: number) => (cursor < offset ? cursor : cursor >= offset + room ? cursor - room + 1 : offset);

/** Which of the `room` shown rows the scrollbar thumb covers, as [from, to). Empty when every row fits. */
export function thumb(offset: number, total: number, room: number): [number, number] {
	if (room <= 0 || total <= room) return [0, 0];
	const size = Math.max(1, Math.round((room * room) / total));
	const from = Math.round((offset / (total - room)) * (room - size));
	return [from, from + size];
}

/** What a picked file puts in the prompt: Pi's own file reference, quoted when the path has a space. */
export const mention = (path: string) => (/\s/.test(path) ? `@"${path}" ` : `@${path} `);

/** The subset of Pi's Theme the panel needs. */
export interface Paint {
	fg(color: "accent" | "borderMuted" | "dim", text: string): string;
	bg(color: "selectedBg", text: string): string;
	bold(text: string): string;
}

/** Cuts text to a width in terminal columns; with `pad`, also fills that width. */
export type Fit = (text: string, width: number, pad?: boolean) => string;

/** A file name is untrusted text: control characters in it must not reach the terminal. */
const printable = (name: string) => name.replace(/[\u0000-\u001f\u007f-\u009f]/g, "�");

/** Lines above the tree. */
export const HEADER = 1;
/** Columns at the right end of the header that close the panel when clicked. */
export const CLOSE = 3;
const KEYS = "↑↓ ←→ enter · esc";

export interface View {
	title: string;
	rows: readonly Entry[];
	open: ReadonlySet<string>;
	/** The first row shown. */
	offset: number;
	/** The row the keyboard is on. Absent while the panel does not have the keyboard. */
	cursor?: number;
}

/**
 * The panel's lines: a header, then the rows that fit. Rows it has nothing for are left out, not
 * drawn blank, because the renderer pays for every line it is given on every frame.
 */
export function view(v: View, width: number, height: number, p: Paint, fit: Fit): string[] {
	// Too narrow for a name next to the rule and the close button.
	if (width < 8) return [];
	const room = Math.max(0, height - HEADER);
	const inner = width - 2;
	// The rule down the left edge doubles as the scrollbar when there are more rows than fit.
	const [from, to] = thumb(v.offset, v.rows.length, room);
	const rule = p.fg("borderMuted", "│");
	const grip = p.fg("accent", "┃");
	// While the keyboard is in the tree, the title makes way for the keys that work there.
	const title = v.cursor === undefined ? p.fg("accent", p.bold(fit(printable(v.title), inner - 2, true))) : p.fg("dim", fit(KEYS, inner - 2, true));
	const lines = [`${rule} ${title} ${p.fg("dim", "×")}`];
	for (let n = 0; n < room && v.offset + n < v.rows.length; n++) {
		const entry = v.rows[v.offset + n];
		const text = `${"  ".repeat(entry.depth)}${entry.dir ? (v.open.has(entry.path) ? "▾ " : "▸ ") : "  "}${printable(entry.name)}`;
		const selected = v.offset + n === v.cursor;
		// Cut as plain text, then coloured as a whole: a cut can then never land inside a colour code.
		const cell = selected ? fit(text, inner, true) : fit(text, inner);
		const colored = entry.dir ? p.fg("accent", cell) : cell;
		// The pointer as well as the background: some themes leave the selection background to the terminal.
		lines.push(`${n >= from && n < to ? grip : rule}${selected ? `${p.fg("accent", "›")}${p.bg("selectedBg", colored)}` : ` ${colored}`}`);
	}
	return lines;
}
