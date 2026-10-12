/**
 * Runs the real `pi` binary with a scripted model: headless for what each request carries, and
 * inside a private tmux server for the strip and the editor.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { hasTmux, runJson, runTui, type Seen } from "../../testkit/pi.ts";
import { block, changeNote } from "../core.ts";

const root = join(import.meta.dirname, "..");
const extensions = [join(root, "index.ts"), join(root, "test/faux.ts")];
/** A request without Pi's own system messages. */
const body = (request: Seen[]) => request.filter((m) => m.role !== "system");

test("pins open every request, and the model is told once when they change", () => {
	const pins = ["use pnpm, never npm", "do not touch the migrations"];
	const r = runJson("pinned", extensions, ["/pin use pnpm, never npm", "/pin do not touch the migrations", "go", "again"]);
	const [first, afterTool, second] = r.seen.map(body);

	assert.deepEqual(first[0], { role: "user", text: block(pins) });
	assert.deepEqual(first[1], { role: "user", text: "go" });
	assert.deepEqual(first.at(-1), { role: "user", text: changeNote(pins) });

	// Later requests still open with the pins, without the note.
	assert.deepEqual(afterTool[0], { role: "user", text: block(pins) });
	assert.equal(afterTool.at(-1)?.role, "toolResult");
	assert.deepEqual(second[0], { role: "user", text: block(pins) });
	assert.deepEqual(second.at(-1), { role: "user", text: "again" });

	// None of it is stored: the session holds the pins themselves, as entries the model is not sent.
	assert.doesNotMatch(JSON.stringify(r.events), /pinned-instructions|system-reminder/);
	assert.deepEqual(
		r.events.filter((e) => e.type === "entry_appended").map((e) => [e.entry.customType, e.entry.data.pins]),
		[
			["pi-pin", [pins[0]]],
			["pi-pin", pins],
		],
	);
});

test("/pin clear removes the pins and tells the model", () => {
	const r = runJson("cleared", extensions, ["/pin use pnpm", "go", "/pin clear", "again"]);
	const second = body(r.seen[1]);
	assert.doesNotMatch(second.map((m) => m.text).join("\n"), /pinned-instructions|use pnpm/);
	assert.deepEqual(second.slice(-2), [
		{ role: "user", text: "again" },
		{ role: "user", text: changeNote([]) },
	]);
});

test("pins are still in force after compaction", () => {
	// Pi refuses to compact a session this small unless it may keep almost nothing verbatim.
	const r = runJson("compacted", extensions, ["/pin use pnpm", "go", "/test-compact", "carry on"], { settings: { compaction: { keepRecentTokens: 1 } } });
	assert.ok(r.events.some((e) => e.type === "compaction_end" && !e.errorMessage), "the session was compacted");
	const after = body(r.seen.at(-1) ?? []);
	assert.deepEqual(after[0], { role: "user", text: block(["use pnpm"]) });
	assert.deepEqual(after.at(-1), { role: "user", text: "carry on" });
});

test("pins are still there when the session is resumed", () => {
	const first = runJson("resume1", extensions, ["/pin use pnpm", "go"]);
	const second = runJson("resume2", extensions, ["again"], { from: first.dir });
	const request = body(second.seen[0]);
	assert.deepEqual(request[0], { role: "user", text: block(["use pnpm"]) });
	assert.deepEqual(request.at(-1), { role: "user", text: "again" });
});

test("the strip shows the pins, and /pin edits them", { skip: !hasTmux && "tmux is not installed" }, async () => {
	const pi = runTui("strip", extensions);
	try {
		await pi.until("pi to start", () => pi.screen().includes("faux-1"));
		pi.submit("/pin use pnpm, never npm");
		await pi.until("the strip", () => pi.screen().includes("📌 use pnpm, never npm"));

		pi.submit("/pin");
		await pi.until("the editor with the pin in it", () => pi.screen().includes("# One pinned instruction per line."));
		pi.keys("C-j");
		pi.submit("keep the public API stable");
		await pi.until("both pins in the strip", () => pi.screen().includes("📌 use pnpm, never npm · keep the public API stable"));

		pi.submit("/pin clear");
		await pi.until("the strip to go", () => !pi.screen().includes("📌"));
	} finally {
		pi.close();
	}
});
