/**
 * Runs the real `pi` binary with a scripted model: headless for what the model is sent, and
 * inside a private tmux server for the panel and for asking while the agent is busy.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { hasTmux, runJson, runTui, type Seen } from "../../testkit/pi.ts";

const root = join(import.meta.dirname, "..");
const extensions = [join(root, "index.ts"), join(root, "test/faux.ts")];
const flat = (request: Seen[]) => request.map((m) => `${m.role}: ${m.text}`).join("\n");

test("a side question reads the conversation, keeps its own thread, and leaves the main one untouched", () => {
	const r = runJson("side", extensions, ["What is the capital of France?", "/btw how many people live there?", "/btw and in 1954?", "carry on"]);
	const [, side1, side2, main2] = r.seen;

	// The side question was given the main conversation as a record.
	assert.match(flat(side1), /<conversation>\n\[User\]: What is the capital of France\?\n\n\[Assistant\]: The capital of France is Paris\.\n<\/conversation>/);
	assert.deepEqual(side1.at(-1), { role: "user", text: "how many people live there?" });

	// The follow-up was given the first side exchange.
	assert.deepEqual(side2.slice(-3), [
		{ role: "user", text: "how many people live there?" },
		{ role: "assistant", text: "About two million." },
		{ role: "user", text: "and in 1954?" },
	]);

	// The main agent was given none of it.
	assert.deepEqual(main2.at(-1), { role: "user", text: "carry on" });
	assert.doesNotMatch(flat(main2), /how many people|two million|1954/);
	// Both exchanges are kept with the session, as entries of the kind Pi never sends to the model.
	assert.deepEqual(
		r.events.filter((e) => e.type === "entry_appended").map((e) => [e.entry.type, e.entry.customType, e.entry.data.question]),
		[
			["custom", "pi-btw", "how many people live there?"],
			["custom", "pi-btw", "and in 1954?"],
		],
	);
});

test("the side thread is still there when the session is resumed", () => {
	const first = runJson("resume1", extensions, ["What is the capital of France?", "/btw how many people live there?"]);
	const second = runJson("resume2", extensions, ["/btw and in 1954?"], { from: first.dir });
	assert.deepEqual(second.seen[0].slice(-3), [
		{ role: "user", text: "how many people live there?" },
		{ role: "assistant", text: "About two million." },
		{ role: "user", text: "and in 1954?" },
	]);
	assert.match(flat(second.seen[0]), /\[Assistant\]: The capital of France is Paris\./);
});

test("/btw history lists every side question and reopens the one you pick", { skip: !hasTmux && "tmux is not installed" }, async () => {
	const pi = runTui("history", extensions);
	const ask = async (question: string, answer: string) => {
		pi.submit(`/btw ${question}`);
		await pi.until(`"${answer}"`, () => pi.screen().includes(answer));
		pi.keys("Escape");
		await pi.until("the panel to close", () => !pi.screen().includes(answer));
	};
	try {
		await pi.until("pi to start", () => pi.screen().includes("faux-1"));
		pi.submit("/btw history");
		await pi.until("the empty-history notice", () => pi.screen().includes("No side questions in this session yet."));

		pi.submit("go");
		await pi.until("the main reply", () => pi.screen().includes("Main reply."));
		await ask("first question?", "First side answer.");
		await ask("second question?", "Second side answer.");

		pi.submit("/btw history");
		await pi.until("the list, newest first", () => /2\. second question\?[\s\S]*1\. first question\?/.test(pi.screen()));
		assert.match(pi.screen(), /btw history/);

		pi.keys("Down");
		pi.keys("Enter");
		await pi.until("the older answer", () => pi.screen().includes("First side answer."));
		assert.match(pi.screen(), /btw first question\?/);

		// Escape goes back to the list, and Escape again leaves it.
		pi.keys("Escape");
		await pi.until("the list again", () => pi.screen().includes("2. second question?") && !pi.screen().includes("First side answer."));
		pi.keys("Escape");
		await pi.until("the list to close", () => !pi.screen().includes("btw history"));
		assert.equal(pi.seen().length, 3, "browsing made no model calls");
	} finally {
		pi.close();
	}
});

test("the panel answers while the agent is busy, and Escape closes it without stopping the agent", { skip: !hasTmux && "tmux is not installed" }, async () => {
	const pi = runTui("busy", extensions);
	try {
		await pi.until("pi to start", () => pi.screen().includes("faux-1"));
		pi.submit("go");
		await pi.until("the agent to be inside its tool call", () => pi.screen().includes("sleep 6"));

		pi.submit("/btw what is it doing?");
		await pi.until("the side answer", () => pi.screen().includes("Side answer: it is running sleep."));
		assert.match(pi.screen(), /btw what is it doing\?/);
		// The tool row still counts up: the main agent is running behind the panel.
		assert.match(pi.screen(), /Elapsed/);
		assert.doesNotMatch(pi.screen(), /Took|Main task finished/);

		pi.keys("Escape");
		await pi.until("the panel to close", () => !pi.screen().includes("Side answer"));
		await pi.until("the main agent to finish on its own", () => pi.screen().includes("Main task finished."));
		assert.doesNotMatch(flat(pi.seen().at(-1) ?? []), /what is it doing|Side answer/, "the main agent never saw the side exchange");

		// `/btw` alone shows the last answer again, without another model call.
		const requests = pi.seen().length;
		pi.submit("/btw");
		await pi.until("the last answer again", () => pi.screen().includes("Side answer: it is running sleep."));
		assert.equal(pi.seen().length, requests);
		pi.keys("Escape");
	} finally {
		pi.close();
	}
});

test("a failing side question shows its error and leaves the session alone", { skip: !hasTmux && "tmux is not installed" }, async () => {
	const pi = runTui("broken", extensions);
	try {
		await pi.until("pi to start", () => pi.screen().includes("faux-1"));
		pi.submit("go");
		await pi.until("the main reply", () => pi.screen().includes("Main reply."));
		// The script has no reply left, so the model call fails.
		pi.submit("/btw anything?");
		await pi.until("the error in the panel", () => pi.screen().includes("No more faux responses queued"));
		pi.keys("Escape");
		await pi.until("the panel to close", () => !pi.screen().includes("No more faux responses queued"));
		assert.match(pi.screen(), /Main reply\./);
	} finally {
		pi.close();
	}
});
