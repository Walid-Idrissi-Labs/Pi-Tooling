import assert from "node:assert/strict";
import { test } from "node:test";
import { AWAY_AFTER_MS, arrived, FOCUS_IN, FOCUS_OUT, isPresent, lastWords, notification, see } from "../core.ts";

test("without focus reports, recent input means the user is here", () => {
	let presence = arrived(0);
	assert.equal(isPresent(presence, AWAY_AFTER_MS - 1), true);
	assert.equal(isPresent(presence, AWAY_AFTER_MS), false);
	presence = see(presence, "a", 60_000);
	assert.equal(isPresent(presence, 60_001), true);
});

test("once the terminal reports focus, only focus counts", () => {
	let presence = see(arrived(0), FOCUS_OUT, 1000);
	assert.equal(isPresent(presence, 1001), false, "just typed, but the window is in the background");
	// Mouse movement over a background window is input, not focus.
	presence = see(presence, "\x1b[<35;10;5M", 2000);
	assert.equal(isPresent(presence, 2001), false);
	presence = see(presence, FOCUS_IN, 3000);
	assert.equal(isPresent(presence, 3_600_000), true, "focused for an hour without typing is still present");
	// One chunk can carry several reports: the last one wins.
	assert.equal(isPresent(see(presence, `${FOCUS_IN}x${FOCUS_OUT}`, 4000), 4001), false);
	assert.equal(isPresent(see(presence, `${FOCUS_OUT}${FOCUS_IN}`, 4000), 4001), true);
});

test("a notification is one OSC 777 sequence and a bell, with nothing that could break out of it", () => {
	assert.equal(notification("π app: done", "All tests pass."), "\x1b]777;notify;π app: done;All tests pass.\x07\x07");
	const hostile = notification("a;b\x07c", "line one\nline two\x1b]0;evil\x07 end");
	assert.equal(hostile, "\x1b]777;notify;a,b c;line one line two ]0;evil end\x07\x07");
	assert.equal(notification("t", "x".repeat(500)).length, "\x1b]777;notify;t;".length + 240 + 2);
});

test("inside tmux the sequence is wrapped so tmux passes it on", () => {
	assert.equal(notification("t", "b", true), "\x1bPtmux;\x1b\x1b]777;notify;t;b\x07\x1b\\\x07");
});

test("the message of a done tap is the agent's last text", () => {
	const messages = [
		{ role: "user", content: [{ type: "text", text: "go" }] },
		{ role: "assistant", content: [{ type: "text", text: "Working on it." }] },
		{ role: "assistant", content: [{ type: "toolCall", name: "bash" }] },
		{ role: "toolResult", content: [{ type: "text", text: "ok" }] },
		{ role: "assistant", content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: " I need the API key. " }] },
		{ role: "compactionSummary" },
	];
	assert.equal(lastWords(messages), "I need the API key.");
	assert.equal(lastWords([]), "");
});
