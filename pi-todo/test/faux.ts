/**
 * Test-only extension: replaces the model with Pi's scripted faux provider, so the end-to-end
 * tests run offline and cost nothing. PI_TODO_SCRIPT picks the script; PI_TODO_SEEN, when set,
 * receives the last message the "model" was sent on each request.
 */

import { appendFileSync } from "node:fs";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const todo = (args: Parameters<typeof fauxToolCall>[1]) => fauxAssistantMessage(fauxToolCall("pi_todo", args), { stopReason: "toolUse" });
const bash = (command: string) => fauxAssistantMessage(fauxToolCall("bash", { command }), { stopReason: "toolUse" });
const say = (text: string) => fauxAssistantMessage(text);

const SCRIPTS: Record<string, ReturnType<typeof say>[]> = {
	// Failing check, missing note, early stop, and a final sweep that catches a regression.
	checks: [
		todo({ action: "plan", items: [{ text: "Create a.txt", check: "test -f a.txt" }, { text: "Review it" }, { text: "Wrap up", check: "true" }] }),
		todo({ action: "done", id: 1 }),
		bash("touch a.txt"),
		todo({ action: "done", id: 1 }),
		say("Finished."),
		todo({ action: "done", id: 2 }),
		todo({ action: "done", id: 2, note: "read a.txt, it is empty as intended" }),
		bash("rm a.txt"),
		todo({ action: "done", id: 3 }),
		bash("touch a.txt"),
		todo({ action: "done", id: 1 }),
		say("All done."),
	],
	// The agent keeps stopping without progress: three reminders, then it is let go.
	stall: [todo({ action: "plan", items: [{ text: "One" }, { text: "Two" }] }), say("Done."), say("Done."), say("Done."), say("Done.")],
	// With a blocked item, one reminder is enough.
	blocked: [
		todo({ action: "plan", items: [{ text: "One" }, { text: "Two" }] }),
		todo({ action: "block", id: 1, note: "needs the API key" }),
		say("I need the API key."),
		say("Nothing else can proceed."),
	],
	// The user adds an item between two prompts.
	edit: [
		todo({ action: "plan", items: [{ text: "One" }] }),
		todo({ action: "done", id: 1, note: "checked by hand" }),
		say("Done."),
		todo({ action: "done", id: 2, note: "did the extra step" }),
		say("Done."),
	],
	// Two runs on one session file: the second must find the list the first one left.
	resume1: [
		todo({ action: "plan", items: [{ text: "One" }, { text: "Two" }] }),
		todo({ action: "done", id: 1, note: "checked by hand" }),
		todo({ action: "block", id: 2, note: "needs the user" }),
		say("Waiting."),
	],
	resume2: [todo({ action: "list" }), say("Still waiting.")],
	// A finished list is gone when the next prompt starts.
	clear: [todo({ action: "plan", items: [{ text: "One" }] }), todo({ action: "done", id: 1, note: "checked by hand" }), say("Done."), todo({ action: "list" }), say("Ok.")],
	// Ten requests without touching the list: the model is shown it again.
	stale: [
		todo({ action: "plan", items: [{ text: "One" }] }),
		...Array.from({ length: 10 }, () => bash("true")),
		todo({ action: "done", id: 1, note: "checked by hand" }),
		say("Done."),
	],
	// Compaction drops the plan from the model's context, so the list is handed back.
	compact: [
		todo({ action: "plan", items: [{ text: "One" }, { text: "Two" }] }),
		todo({ action: "done", id: 1, note: "checked by hand" }),
		todo({ action: "block", id: 2, note: "needs the user" }),
		say("Waiting."),
		say("Summary: one item done, one blocked."),
		todo({ action: "list" }),
		say("Still waiting."),
	],
};

export default function (pi: ExtensionAPI) {
	const faux = fauxProvider();
	const seen = process.env.PI_TODO_SEEN;
	faux.setResponses(
		(SCRIPTS[process.env.PI_TODO_SCRIPT ?? ""] ?? []).map((message) => (context) => {
			const last = context.messages[context.messages.length - 1];
			if (seen) appendFileSync(seen, `${JSON.stringify(last?.content ?? null)}\n`);
			return message;
		}),
	);
	pi.registerProvider(faux.provider);

	// Stands in for pi-shoulder-tap: records the taps pi-todo asks for.
	pi.events.on("shoulder-tap", (tap) => {
		if (seen) appendFileSync(`${seen}.taps`, `${JSON.stringify(tap)}\n`);
	});

	// The built-in /compact lives in the interactive UI, so the tests go through the extension API.
	pi.registerCommand("test-compact", {
		handler: (_args, ctx) => new Promise<void>((resolve, reject) => ctx.compact({ onComplete: () => resolve(), onError: reject })),
	});
}
