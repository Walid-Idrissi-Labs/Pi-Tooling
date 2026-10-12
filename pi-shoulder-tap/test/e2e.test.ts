/**
 * Drives the real Pi terminal UI inside a private tmux server and reads the raw bytes Pi writes,
 * which is the only place a notification exists. Window focus is simulated by sending the
 * sequences a terminal reports.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { hasTmux, runTui } from "../../testkit/pi.ts";
import { FOCUS_IN, FOCUS_OUT } from "../core.ts";

const root = join(import.meta.dirname, "..");

test("taps only when the user is away, once per reason", { skip: !hasTmux && "tmux is not installed" }, async () => {
	const pi = runTui("taps", [join(root, "index.ts"), join(root, "test/faux.ts")]);
	const taps = () => pi.raw().split("]777;notify;").slice(1).map((rest) => rest.split("\x07")[0]);
	const settled = (reply: string) => pi.until(`"${reply}" and an idle prompt`, () => pi.screen().includes(reply) && !pi.screen().includes("Working"));
	try {
		await pi.until("pi to start", () => pi.screen().includes("faux-1"));

		// Typed a moment ago and never left: no tap.
		pi.submit("one");
		await settled("First reply.");
		assert.deepEqual(taps(), []);

		// Switched to another window: the run ends with a tap carrying the agent's last words.
		pi.bytes(FOCUS_OUT);
		pi.submit("two");
		await pi.until("the done tap", () => taps().length === 1);
		assert.match(taps()[0], /^π cwd: done;Second reply\.$/);

		// The agent opens a dialog: one tap for the question, one when the run ends.
		pi.submit("three");
		await pi.until("the asking tap", () => taps().length === 2);
		assert.match(taps()[1], /^π cwd: asking;Deploy now\?$/);
		pi.keys("Enter");
		await pi.until("the second done tap", () => taps().length === 3);
		assert.match(taps()[2], /^π cwd: done;Third reply\.$/);

		// Another extension explains why the run stopped: its tap replaces the generic one.
		pi.submit("/arm");
		pi.submit("four");
		await settled("Fourth reply.");
		await pi.until("the requested tap", () => taps().length === 4);
		assert.match(taps()[3], /^π cwd: todo blocked;#3 Deploy; needs VPN access$/);

		// Back at the terminal: quiet again.
		pi.bytes(FOCUS_IN);
		pi.submit("five");
		await settled("Fifth reply.");
		assert.equal(taps().length, 4);
	} finally {
		pi.close();
	}
});
