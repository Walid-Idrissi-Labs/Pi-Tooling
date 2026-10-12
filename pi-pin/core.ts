/**
 * pi-pin core: the texts built from the pinned instructions. No imports, so it runs under plain
 * `node --test`.
 */

const one = (text: string) => text.replace(/\s+/g, " ").trim();

/** Adds a pin, as a single line. A blank or repeated one changes nothing. */
export function add(pins: readonly string[], text: string): string[] {
	const pin = one(text);
	return !pin || pins.includes(pin) ? [...pins] : [...pins, pin];
}

// --- Text the user edits ---

export const toEditText = (pins: readonly string[]) => ["# One pinned instruction per line. Delete a line to unpin it.", ...pins].join("\n");

export const fromEditText = (text: string) =>
	text
		.split("\n")
		.filter((line) => !line.trim().startsWith("#"))
		.reduce<string[]>(add, []);

// --- Text for the model ---

const list = (pins: readonly string[]) => pins.map((pin) => `- ${pin}`).join("\n");

/** Opens every request, so the instructions are still there after compaction drops the turn they were given in. */
export const block = (pins: readonly string[]) =>
	`<pinned-instructions>\nThe user pinned these instructions for the whole session. Follow them in everything you do, until the user removes them:\n${list(pins)}\n</pinned-instructions>`;

/** Closes one request after a change, so the agent notices it now and not at its next look at the top of the context. */
export const changeNote = (pins: readonly string[]) =>
	`<system-reminder>\n${pins.length ? `The user changed the pinned instructions. They are now:\n${list(pins)}` : "The user removed all pinned instructions."}\n</system-reminder>`;

// --- Text on screen ---

const ROWS = 3;
const GAP = "  ";
/** A column narrower than this cuts too much of a pin to be worth showing. */
const MIN_COLUMN = 28;

/**
 * The strip: one pin per line, at most three lines. More pins flow into further columns, so they
 * all stay on screen. `fit` cuts or pads a cell to a display width (an emoji is two columns wide).
 */
export function strip(pins: readonly string[], width: number, fit: (text: string, width: number) => string): string[] {
	const columns = Math.min(Math.ceil(pins.length / ROWS), Math.max(1, Math.floor((width + GAP.length) / (MIN_COLUMN + GAP.length))));
	const room = columns * ROWS;
	const marked = pins.map((pin) => `📌 ${pin}`);
	// Too many even for columns: the last cell says how many are out of sight.
	const cells = marked.length > room ? [...marked.slice(0, room - 1), `+${marked.length - room + 1} more, /pin shows all`] : marked;
	const cellWidth = Math.floor((width - GAP.length * (columns - 1)) / columns);
	return Array.from({ length: Math.min(ROWS, cells.length) }, (_, row) =>
		Array.from({ length: columns }, (_, column) => cells[column * ROWS + row])
			.filter((cell) => cell !== undefined)
			.map((cell) => fit(cell, cellWidth))
			.join(GAP),
	);
}
