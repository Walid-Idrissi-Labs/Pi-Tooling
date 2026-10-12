import assert from "node:assert/strict";
import { test } from "node:test";
import { add, close, count, finish, fromEditText, type Item, PLAIN, panel, plan, reopen, start, toEditText } from "../core.ts";

const states = (items: Item[]) => items.map((i) => `${i.id}:${i.status}`).join(" ");
/** Drops undefined fields and key order, which do not survive a session file anyway. */
const stored = (items: Item[]) => JSON.parse(JSON.stringify(items));

test("plan starts the first item and done moves the focus on", () => {
	let items = plan([], [{ text: " a ", check: "true" }, { text: "b" }], undefined, 1000);
	assert.equal(states(items), "1:in_progress 2:pending");
	assert.equal(items[0].text, "a");
	items = finish(items, 1, { verified: true });
	assert.equal(states(items), "1:done 2:in_progress");
	assert.deepEqual(count(items), { done: 1, total: 2 });
});

test("a new plan cannot silently replace open items", () => {
	const items = plan([], [{ text: "a" }, { text: "b" }]);
	assert.throws(() => plan(items, [{ text: "c" }]), /still open/);
	assert.equal(states(plan(items, [{ text: "c" }], "user changed direction")), "1:in_progress");
	assert.throws(() => plan([], []), /at least one/);
});

test("block and drop need a reason; drop moves on, block waits", () => {
	const items = plan([], [{ text: "a" }, { text: "b" }, { text: "c" }]);
	assert.throws(() => close(items, 1, "blocked", " "), /why #1 is blocked/);
	assert.throws(() => close(items, 9, "dropped", "x"), /No item #9/);
	assert.equal(states(close(items, 1, "blocked", "needs a key")), "1:blocked 2:pending 3:pending");
	const dropped = close(items, 1, "dropped", "not needed");
	assert.equal(states(dropped), "1:dropped 2:in_progress 3:pending");
	assert.deepEqual(count(dropped), { done: 0, total: 2 });
});

test("start keeps one item in progress; add and reopen restore the focus", () => {
	let items = plan([], [{ text: "a" }, { text: "b" }]);
	items = start(items, 2);
	assert.equal(states(items), "1:pending 2:in_progress");
	items = finish(finish(items, 2, { verified: false, note: "seen" }), 1, { verified: true });
	assert.equal(states(items), "1:done 2:done");
	assert.equal(states(add(items, [{ text: "c" }])), "1:done 2:done 3:in_progress");
	const reopened = reopen(items, [1]);
	assert.equal(states(reopened), "1:in_progress 2:done");
	assert.equal(reopened[0].verified, undefined);
});

test("functions never mutate the list they are given", () => {
	const items = plan([], [{ text: "a" }, { text: "b" }]);
	const before = JSON.stringify(items);
	finish(items, 1, { verified: true });
	close(items, 2, "dropped", "x");
	fromEditText("[x] #1 a\n    note: n", items);
	assert.equal(JSON.stringify(items), before);
});

test("the edit text round-trips and applies the user's changes", () => {
	let items = plan([], [{ text: "a", check: "npm test" }, { text: "b" }, { text: "c" }], undefined, 1000);
	items = close(finish(items, 1, { verified: true }), 3, "blocked", "needs a key");
	assert.deepEqual(stored(fromEditText(toEditText(items), items)), stored(items));

	const edited = fromEditText(
		[
			"# a comment",
			"[>] #3 c, reworded", // reordered, unblocked, renamed
			"[x] #1 a", // check line removed, still done
			"[>] #1 a copy", // duplicate id and a second in-progress item
			"brand new", // no box, no id
			"[x] #2", // text deleted: the line is ignored
		].join("\n"),
		items,
		2000,
	);
	assert.deepEqual(
		edited.map((i) => [i.id, i.text, i.status]),
		[
			[3, "c, reworded", "in_progress"],
			[1, "a", "done"],
			[4, "a copy", "pending"],
			[5, "brand new", "pending"],
		],
	);
	assert.equal(edited[0].note, undefined);
	assert.equal(edited[0].startedAt, 2000);
	assert.equal(edited[1].check, undefined);
	assert.equal(edited[1].verified, true);
});

test("the panel gives each item one line, and a second one only for what needs saying", () => {
	let items = plan([], [{ text: "a", check: "make a" }, { text: "b", check: "make b" }, { text: "c" }, { text: "d" }, { text: "e" }], undefined, 0);
	items = finish(items, 1, { verified: true }, 0);
	items = close(items, 3, "blocked", "needs a key", 0);
	items = close(items, 4, "dropped", "not needed", 0);
	assert.deepEqual(panel(items, PLAIN, { runningSince: 5000, now: 70_000 }), [
		"Todos 1/4",
		"✔ #1 a",
		// The step being worked on: time in this run, and the check that will decide it.
		"▸ #2 b  1m05s",
		"     $ make b",
		"⊘ #3 c",
		"     needs a key",
		"✗ #4 d",
		"     not needed",
		"◻ #5 e",
	]);
	// Idle: no timer. A waiting item does not show its check yet.
	assert.deepEqual(panel(plan([], [{ text: "a" }, { text: "b", check: "make b" }]), PLAIN, { auto: false }), ["Todos 0/2  keep-going off", "▸ #1 a", "◻ #2 b"]);
});

test("a long list is windowed around the active item, with one square per item so none is lost from view", () => {
	let items = plan([], Array.from({ length: 14 }, (_, n) => ({ text: `step ${n + 1}`, check: n === 5 ? "make test" : undefined })), undefined, 0);
	for (const id of [1, 2, 3, 4, 5]) items = finish(items, id, { verified: id % 2 === 0, note: "seen" }, 0);
	const lines = panel(items, PLAIN);
	assert.deepEqual(lines.slice(0, 6), ["Todos 5/14  ■■■■■■□□□□□□□□", "  … 3 above", "✔ #4 step 4", "✓ #5 step 5", "▸ #6 step 6", "     $ make test"]);
	assert.deepEqual(lines.slice(-2), ["◻ #12 step 12", "  … 2 more"]);
	// Ten lines for the items, plus the header and the two markers.
	assert.equal(lines.length, 13);
	// Near the end, the window reaches back instead of leaving lines unused.
	for (const id of [6, 7, 8, 9, 10, 11, 12]) items = finish(items, id, { verified: true }, 0);
	assert.deepEqual(panel(items, PLAIN).slice(1, 3), ["  … 4 above", "✓ #5 step 5"]);
	assert.equal(panel(items, PLAIN).at(-1), "◻ #14 step 14");
});
