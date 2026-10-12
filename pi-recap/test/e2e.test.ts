/**
 * Runs the real `pi` binary with a scripted model: headless for what the recap records, and
 * inside a private tmux server for how it appears.
 */

import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { hasTmux, runJson, runTui } from "../../testkit/pi.ts";
import type { Recap } from "../core.ts";

const root = join(import.meta.dirname, "..");
const extensions = [join(root, "index.ts"), join(root, "test/faux.ts")];
const recaps = (events: { type: string; entry?: { customType?: string; data?: Recap } }[]) =>
	events.flatMap((e) => (e.type === "entry_appended" && e.entry?.customType === "pi-recap" && e.entry.data ? [e.entry.data] : []));

test("a busy run ends with a receipt of what it did, which the model is never sent", () => {
	const r = runJson("work", extensions, ["go", "again"]);
	const [recap, ...others] = recaps(r.events);
	assert.deepEqual(others, [], "one recap, for the busy run only");
	assert.deepEqual(recap.tools, { bash: 4, write: 1, edit: 1 });
	assert.deepEqual(recap.files, [{ path: "notes.md", changes: 2 }]);
	// `test -f flag.txt` failed, then passed once the file existed. `exit 3` never did.
	assert.deepEqual(recap.commands, { run: 4, failed: 2, stillFailing: ["exit 3"] });
	assert.deepEqual(recap.asked, []);
	assert.equal(recap.todos, undefined);
	assert.ok(recap.endedAt >= recap.startedAt);

	const lastRequest = r.seen.at(-1) ?? [];
	assert.deepEqual(lastRequest.at(-1), { role: "user", text: "again" });
	assert.doesNotMatch(lastRequest.map((m) => m.text).join("\n"), /recap|still failing|stillFailing/i);
});

test("a short run gets no recap", () => {
	assert.deepEqual(recaps(runJson("short", extensions, ["go"]).events), []);
});

test("with pi-todo, the recap carries the checklist", () => {
	const r = runJson("todos", [join(root, "../pi-todo/index.ts"), ...extensions], ["go"]);
	assert.deepEqual(recaps(r.events)[0].todos, { done: 1, total: 2, blocked: ["Two: needs the user"] });
	assert.deepEqual(recaps(r.events)[0].tools, { pi_todo: 3, bash: 2 });
});

test("the recap appears in the transcript, lists the dialog the agent opened, and /recap shows it again", { skip: !hasTmux && "tmux is not installed" }, async () => {
	const pi = runTui("asks", extensions);
	const count = (needle: string) => pi.screen().split(needle).length - 1;
	try {
		await pi.until("pi to start", () => pi.screen().includes("faux-1"));
		pi.submit("/recap");
		await pi.until("the empty notice", () => pi.screen().includes("Nothing to recap yet."));

		pi.submit("go");
		await pi.until("the agent's dialog", () => pi.screen().includes("Deploy now?"));
		pi.keys("Enter");
		await pi.until("the recap in the transcript", () => /recap · \d+s · 5 tool calls/.test(pi.screen()));
		assert.match(pi.screen(), /ran\s+4 commands\n/);
		assert.match(pi.screen(), /asked\s+Deploy now\?/);
		assert.match(pi.screen(), /tools\s+bash 4 · ask 1/);

		pi.submit("/recap");
		await pi.until("the recap a second time", () => count("recap · ") === 2);
	} finally {
		pi.close();
	}
});
