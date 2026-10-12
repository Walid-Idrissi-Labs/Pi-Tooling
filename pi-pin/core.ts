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

export const strip = (pins: readonly string[]) => `📌 ${pins.join(" · ")}`;
