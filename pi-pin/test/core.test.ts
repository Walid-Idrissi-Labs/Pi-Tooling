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

test("the strip shows every pin on one line", () => {
	assert.equal(strip(["use pnpm", "keep the API stable"]), "📌 use pnpm · keep the API stable");
});
