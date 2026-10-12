import assert from "node:assert/strict";
import { test } from "node:test";
import { add, block, changeNote, fromEditText, strip, toEditText } from "../core.ts";

test("a pin is one line, and adding it twice changes nothing", () => {
	const pins = add([], "  use pnpm,\n never npm ");
	assert.deepEqual(pins, ["use pnpm, never npm"]);
	assert.deepEqual(add(pins, "use pnpm, never npm"), pins);
	assert.deepEqual(add(pins, "   "), pins);
	assert.deepEqual(add(pins, "keep the API stable"), ["use pnpm, never npm", "keep the API stable"]);
});

test("the edit text round-trips, and editing it adds, removes and reorders pins", () => {
	const pins = ["use pnpm, never npm", "keep the API stable"];
	assert.deepEqual(fromEditText(toEditText(pins)), pins);
	assert.deepEqual(fromEditText("# a comment\n\n  keep the API stable  \nask before deleting files\nkeep the API stable\n"), ["keep the API stable", "ask before deleting files"]);
	assert.deepEqual(fromEditText(toEditText([])), []);
});

test("the model is given the pins as standing instructions, and told when they change", () => {
	assert.equal(
		block(["use pnpm", "keep the API stable"]),
		"<pinned-instructions>\nThe user pinned these instructions for the whole session. Follow them in everything you do, until the user removes them:\n- use pnpm\n- keep the API stable\n</pinned-instructions>",
	);
	assert.equal(changeNote(["use pnpm"]), "<system-reminder>\nThe user changed the pinned instructions. They are now:\n- use pnpm\n</system-reminder>");
	assert.equal(changeNote([]), "<system-reminder>\nThe user removed all pinned instructions.\n</system-reminder>");
});

// Cuts or pads to a width, like the terminal helper does. The pin emoji is two columns and two UTF-16 units, so lengths agree.
const fit = (text: string, width: number) => (text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width));
const pinsNamed = (n: number) => Array.from({ length: n }, (_, i) => `pin ${i + 1}`);

test("up to three pins are shown one under the other", () => {
	assert.deepEqual(strip(["use pnpm", "keep the API stable"], 30, fit), ["📌 use pnpm".padEnd(30), "📌 keep the API stable".padEnd(30)]);
	assert.deepEqual(strip(["a pin far too long for a narrow terminal"], 20, fit), ["📌 a pin far too lo…"]);
	assert.equal(strip(pinsNamed(3), 80, fit).length, 3);
	assert.deepEqual(strip([], 80, fit), []);
});

test("more than three pins flow into further columns, so all stay on screen", () => {
	// Two columns of 39, filled top to bottom: the first three keep their place.
	assert.deepEqual(strip(pinsNamed(5), 80, fit), [
		`${"📌 pin 1".padEnd(39)}  ${"📌 pin 4".padEnd(39)}`,
		`${"📌 pin 2".padEnd(39)}  ${"📌 pin 5".padEnd(39)}`,
		"📌 pin 3".padEnd(39),
	]);
	// Nine pins take three columns when the terminal is wide enough for them.
	assert.match(strip(pinsNamed(9), 120, fit)[0], /^📌 pin 1 +📌 pin 4 +📌 pin 7 +$/);
});

test("when even columns run out, the last cell says how many pins are out of sight", () => {
	// 60 columns hold two columns of at least 28, so six cells for eight pins.
	const rows = strip(pinsNamed(8), 60, fit);
	assert.match(rows[0], /^📌 pin 1 +📌 pin 4 +$/);
	assert.match(rows[2], /^📌 pin 3 +\+3 more, \/pin shows all +$/);
	// A terminal too narrow for two columns keeps one.
	assert.deepEqual(strip(pinsNamed(5), 40, fit).map((row) => row.trimEnd()), ["📌 pin 1", "📌 pin 2", "+3 more, /pin shows all"]);
});
