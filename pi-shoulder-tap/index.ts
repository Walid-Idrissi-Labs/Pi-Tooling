/**
 * pi-shoulder-tap - a desktop notification when Pi needs you, and only then.
 *
 * It taps when:
 * - a run settles (with the agent's last words as the message),
 * - the agent opens a dialog and waits for an answer,
 * - another extension asks for it: pi.events.emit("shoulder-tap", { title, body }).
 *
 * It stays quiet while you are looking at the terminal, and in subagent sessions.
 * `/shoulder-tap` sends a test notification.
 */

import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { arrived, isPresent, lastWords, notification, see } from "./core.ts";

/** The event other extensions emit to ask for a tap. */
const EVENT = "shoulder-tap";

export default function (pi: ExtensionAPI) {
	// A subagent reports to the agent that started it, not to the user.
	if (process.env.PI_SUBAGENT_NAME || process.env.PI_SUBAGENT_CHILD) return;

	// Only in the terminal UI: elsewhere stdout is a data stream that escape bytes would corrupt.
	let active = false;
	let project = "";
	let presence = arrived(Date.now());
	let said = "";
	let tappedSinceEnd = false;
	// Read straight from stdin, next to Pi's own reader: in fullscreen mode Pi consumes focus reports before extension input listeners see them.
	const watch = (chunk: unknown) => {
		presence = see(presence, String(chunk), Date.now());
	};

	const tap = (what: string, body: string, evenIfPresent = false) => {
		tappedSinceEnd = true;
		if (!active || (!evenIfPresent && isPresent(presence, Date.now()))) return;
		process.stdout.write(notification(`π ${project}: ${what}`, body, !!process.env.TMUX));
	};

	pi.on("session_start", (_event, ctx) => {
		active = ctx.mode === "tui";
		project = basename(ctx.cwd);
		presence = arrived(Date.now());
		process.stdin.off("data", watch);
		if (active) process.stdin.on("data", watch);
	});
	pi.on("session_shutdown", () => void process.stdin.off("data", watch));

	pi.on("agent_end", (event) => {
		said = lastWords(event.messages);
		tappedSinceEnd = false;
	});

	pi.on("agent_settled", (event) => {
		// Aborted means you pressed Escape. A tap since the run ended already said why it stopped.
		if (event.aborted || tappedSinceEnd) return;
		tap("done", said || "Ready for your next message.");
	});

	pi.on("ui_prompt_start", (event) => tap("asking", event.title ?? "Waiting for your answer."));

	pi.events.on(EVENT, (data) => {
		const { title, body } = (data ?? {}) as { title?: unknown; body?: unknown };
		if (typeof body === "string") tap(typeof title === "string" ? title : "needs you", body);
	});

	pi.registerCommand(EVENT, {
		description: "Send a test notification in 5 seconds (switch to another window first)",
		handler: async (_args, ctx) => {
			if (!active) return ctx.ui.notify(`${EVENT} only works in the terminal UI`, "warning");
			ctx.ui.notify("Test notification in 5 seconds. Switch to another window now: most terminals hide it while focused.", "info");
			setTimeout(() => tap("test", "This is what a tap looks like.", true), 5000);
		},
	});
}
