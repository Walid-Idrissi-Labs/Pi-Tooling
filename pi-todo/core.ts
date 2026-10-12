/**
 * pi-todo core: list state and text formats. No Pi imports, so it runs under plain `node --test`.
 *
 * Every function returns a new list and never mutates its input: snapshots stored in the
 * session share these objects.
 */

export type Status = "pending" | "in_progress" | "done" | "blocked" | "dropped";

export interface Item {
	id: number;
	text: string;
	status: Status;
	/** Shell command that must exit 0 before the item can be ticked. */
	check?: string;
	/** What was verified (done), or why (blocked, dropped). */
	note?: string;
	/** True when `check` passed as run by the extension, not as reported by the agent. */
	verified?: boolean;
	startedAt?: number;
}

export interface Spec {
	text: string;
	check?: string;
}

/** The subset of Pi's Theme the panel needs. */
export interface Paint {
	fg(color: "accent" | "success" | "warning" | "muted" | "dim", text: string): string;
	bold(text: string): string;
	strikethrough(text: string): string;
}

export const PLAIN: Paint = { fg: (_color, text) => text, bold: (text) => text, strikethrough: (text) => text };

/** Still workable: the run may not end while any item is in one of these states. */
export const isOpen = (i: Item) => i.status === "pending" || i.status === "in_progress";
/** Not finished: workable, or waiting on the user. */
export const isUnresolved = (i: Item) => isOpen(i) || i.status === "blocked";

export const count = (items: Item[]) => ({
	done: items.filter((i) => i.status === "done").length,
	total: items.filter((i) => i.status !== "dropped").length,
});

export function get(items: Item[], id: number | undefined): Item {
	const item = items.find((i) => i.id === id);
	if (!item) throw new Error(id === undefined ? "This action needs an item id." : `No item #${id}. Use action "list" to see the ids.`);
	return item;
}

const set = (items: Item[], id: number, patch: Partial<Item>) => items.map((i) => (i.id === id ? { ...i, ...patch } : i));

const nextId = (items: Item[]) => Math.max(0, ...items.map((i) => i.id)) + 1;

/** Keeps exactly one item in focus: starts the first pending item when nothing is in progress. */
function advance(items: Item[], now: number): Item[] {
	if (items.some((i) => i.status === "in_progress")) return items;
	const next = items.find((i) => i.status === "pending");
	return next ? set(items, next.id, { status: "in_progress", startedAt: now }) : items;
}

function create(specs: Spec[] | undefined, firstId: number): Item[] {
	if (!specs?.length) throw new Error("Pass items: at least one { text }.");
	return specs.map((spec, n) => {
		const text = spec.text?.trim();
		if (!text) throw new Error("Every item needs a non-empty text.");
		const check = spec.check?.trim();
		return { id: firstId + n, text, status: "pending", ...(check ? { check } : {}) };
	});
}

export function plan(items: Item[], specs: Spec[] | undefined, note?: string, now = Date.now()): Item[] {
	const open = items.filter(isUnresolved);
	// Replacing the plan must not be a silent way out of unfinished items.
	if (open.length && !note?.trim())
		throw new Error(
			`${open.length} item(s) are still open:\n${listText(open)}\nUse action "add" to append to the list, or pass note saying why they are being replaced.`,
		);
	return advance(create(specs, 1), now);
}

export function add(items: Item[], specs: Spec[] | undefined, now = Date.now()): Item[] {
	return advance([...items, ...create(specs, nextId(items))], now);
}

export function start(items: Item[], id: number | undefined, now = Date.now()): Item[] {
	const item = get(items, id);
	if (item.status === "in_progress") return items;
	const paused = items.map((i) => (i.status === "in_progress" ? { ...i, status: "pending" as const } : i));
	return set(paused, item.id, { status: "in_progress", startedAt: now, note: undefined, verified: undefined });
}

export function finish(items: Item[], id: number, proof: { verified: boolean; note?: string }, now = Date.now()): Item[] {
	return advance(set(items, id, { status: "done", verified: proof.verified, note: proof.note?.trim() || undefined }), now);
}

export function close(items: Item[], id: number | undefined, status: "blocked" | "dropped", note: string | undefined, now = Date.now()): Item[] {
	const item = get(items, id);
	if (!note?.trim()) throw new Error(`Pass note: why #${item.id} is ${status}. The user will read it.`);
	const next = set(items, item.id, { status, note: note.trim(), verified: undefined });
	// A dropped item is closed, so work moves on. A blocked one waits: what to do next is the agent's call.
	return status === "dropped" ? advance(next, now) : next;
}

export function reopen(items: Item[], ids: number[], now = Date.now()): Item[] {
	return advance(
		items.map((i) => (ids.includes(i.id) ? { ...i, status: "pending" as const, verified: undefined } : i)),
		now,
	);
}

// --- Text for the model ---

export const line = (i: Item) => `#${i.id} ${i.text}${i.check ? ` (check: ${i.check})` : ""}`;

export const listText = (items: Item[]) =>
	items.map((i) => `#${i.id} [${i.status}${i.note && i.status !== "done" ? `: ${i.note}` : ""}] ${i.text}${i.check ? ` (check: ${i.check})` : ""}`).join("\n");

// --- Text the user edits ---

const MARKS: Record<Status, string> = { pending: " ", in_progress: ">", done: "x", blocked: "!", dropped: "-" };
const STATUS_OF: Record<string, Status> = { ">": "in_progress", x: "done", X: "done", "!": "blocked", "-": "dropped" };

export function toEditText(items: Item[]): string {
	return [
		"# One item per line. Reorder, delete or add lines, and change the box.",
		"# [ ] pending   [>] in progress   [x] done   [!] blocked   [-] dropped",
		...items.flatMap((i) => [
			`[${MARKS[i.status]}] #${i.id} ${i.text}`,
			...(i.check ? [`    check: ${i.check}`] : []),
			...(i.note ? [`    note: ${i.note}`] : []),
		]),
	].join("\n");
}

/** Parses the edited text. Lines keep their item by `#id`; a line without a known id is a new item. */
export function fromEditText(text: string, old: Item[], now = Date.now()): Item[] {
	const unused = new Map(old.map((i) => [i.id, i]));
	let fresh = nextId(old);
	const out: Item[] = [];
	for (const raw of text.split("\n")) {
		const field = /^\s+(check|note):(.*)$/.exec(raw);
		if (field && out.length) {
			out[out.length - 1][field[1] as "check" | "note"] = field[2].trim() || undefined;
			continue;
		}
		const [, mark, id, body] = /^(?:\[(.?)\])?\s*(?:#(\d+)\b)?\s*(.*)$/.exec(raw.trim()) ?? [];
		if (!body || (mark === undefined && id === undefined && body.startsWith("#"))) continue;
		const prev = id ? unused.get(Number(id)) : undefined;
		// A duplicated line keeps the id only once; the copy becomes a new item.
		if (prev) unused.delete(prev.id);
		const status = STATUS_OF[mark ?? ""] ?? "pending";
		const same = prev?.status === status;
		out.push({
			id: prev?.id ?? fresh++,
			text: body,
			status,
			verified: same ? prev.verified : undefined,
			startedAt: same ? prev.startedAt : status === "in_progress" ? now : undefined,
		});
	}
	let active = false;
	return out.map((i) => {
		if (i.status !== "in_progress") return i;
		if (active) return { ...i, status: "pending" as const, startedAt: undefined };
		active = true;
		return i;
	});
}

// --- Panel ---

/** Lines for the items, second lines included. The header and the "more" markers come on top. */
const MAX_LINES = 10;

function elapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

export interface PanelOptions {
	/** False when the user switched keep-going off. */
	auto?: boolean;
	/** When the agent started working on the current prompt; undefined while it is idle. */
	runningSince?: number;
	now?: number;
}

export function panel(items: Item[], p: Paint, { auto = true, runningSince, now = Date.now() }: PanelOptions = {}): string[] {
	const { done, total } = count(items);
	// Time on this step in the current run. Hidden while idle, when wall-clock time would count the user's absence.
	const timer = (i: Item) => (runningSince === undefined ? "" : p.fg("dim", `  ${elapsed(now - Math.max(i.startedAt ?? 0, runningSince))}`));
	// One line per item. What needs saying about it goes on a second line under its text:
	// the check being run, or why it is blocked or dropped.
	const lines = (i: Item): string[] => {
		const id = p.fg("dim", `#${i.id}`);
		const under = (text: string) => `${" ".repeat(String(i.id).length + 4)}${text}`;
		switch (i.status) {
			case "done":
				// Green tick: the check command passed. Grey tick: the agent's (or user's) word.
				return [`${i.verified ? p.fg("success", "✔") : p.fg("muted", "✓")} ${id} ${p.fg("dim", p.strikethrough(i.text))}`];
			case "in_progress":
				return [`${p.fg("accent", "▸")} ${id} ${p.bold(i.text)}${timer(i)}`, ...(i.check ? [under(p.fg("dim", `$ ${i.check}`))] : [])];
			case "pending":
				return [`${p.fg("muted", "◻")} ${id} ${i.text}`];
			case "blocked":
				return [`${p.fg("warning", "⊘")} ${id} ${i.text}`, ...(i.note ? [under(p.fg("warning", i.note))] : [])];
			case "dropped":
				return [`${p.fg("dim", "✗")} ${id} ${p.fg("dim", p.strikethrough(i.text))}`, ...(i.note ? [under(p.fg("dim", i.note))] : [])];
		}
	};
	const blocks = items.map(lines);
	// The window follows the item being worked on, then takes whatever lines are left around it.
	const focus = ["in_progress", "pending"].map((s) => items.findIndex((i) => i.status === s)).find((n) => n >= 0) ?? items.length - 1;
	let from = Math.max(0, focus - 2);
	let to = from;
	let used = 0;
	while (to < blocks.length && used + blocks[to].length <= MAX_LINES) used += blocks[to++].length;
	while (from > 0 && used + blocks[from - 1].length <= MAX_LINES) used += blocks[--from].length;
	const below = blocks.length - to;
	// When items are out of sight, one square each keeps the whole list on screen.
	const square = (i: Item) =>
		i.status === "pending" ? p.fg("dim", "□") : p.fg(i.status === "done" ? (i.verified ? "success" : "muted") : i.status === "blocked" ? "warning" : "accent", "■");
	const overview = from || below ? `  ${items.filter((i) => i.status !== "dropped").map(square).join("")}` : "";
	return [
		p.fg("accent", p.bold(`Todos ${done}/${total}`)) + overview + (auto ? "" : p.fg("warning", "  keep-going off")),
		...(from ? [p.fg("dim", `  … ${from} above`)] : []),
		...blocks.slice(from, to).flat(),
		...(below ? [p.fg("dim", `  … ${below} more`)] : []),
	];
}
