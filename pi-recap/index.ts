/**
 * pi-recap - a short, factual receipt of what the agent did while you were not watching.
 *
 * When a run with enough activity settles, a recap is added to the transcript: files changed,
 * commands run and which are still failing, the checklist, the dialogs it opened. It is built
 * from tool events, with no model call, and stored as a session entry the model is never sent.
 *
 * `/recap` shows the same for the run in progress, or for the last one.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { asked, finish, lines, type Recap, type Run, record, start, worthIt } from "./core.ts";

const NAME = "pi-recap";

export default function (pi: ExtensionAPI) {
	let run: Run | undefined;
	let last: Recap | undefined;
	let toolsRunning = 0;
	let cwd = "";

	pi.on("session_start", (_event, ctx) => {
		cwd = ctx.cwd;
		run = undefined;
		toolsRunning = 0;
	});

	// One run lasts from the first agent start until Pi settles, so continuations and retries belong to it.
	pi.on("agent_start", () => {
		run ??= start(Date.now());
	});

	pi.on("tool_execution_start", (event) => {
		if (!event.parentToolCallId) toolsRunning++;
	});
	pi.on("tool_execution_end", (event) => {
		if (!event.parentToolCallId) toolsRunning = Math.max(0, toolsRunning - 1);
	});

	// Calls a tool makes itself (pi-todo running a check) are its business, not the agent's.
	pi.on("tool_result", (event) => {
		if (run && !event.parentToolCallId) run = record(run, event, cwd);
	});

	// A dialog that opens while a tool is running came from the agent. One you opened yourself did not.
	pi.on("ui_prompt_start", (event) => {
		if (run && toolsRunning > 0 && event.title) run = asked(run, event.title);
	});

	pi.on("agent_settled", () => {
		if (!run) return;
		last = finish(run, Date.now());
		run = undefined;
		if (worthIt(last)) pi.appendEntry<Recap>(NAME, last);
	});

	pi.registerEntryRenderer<Recap>(NAME, (entry, { expanded }, theme) =>
		entry.data ? new Text(lines(entry.data, theme, expanded ? Number.POSITIVE_INFINITY : 4).join("\n"), 1, 0) : undefined,
	);

	const stored = (ctx: ExtensionContext) =>
		ctx.sessionManager
			.getBranch()
			.flatMap((entry) => (entry.type === "custom" && entry.customType === NAME && entry.data ? [entry.data as Recap] : []))
			.at(-1);

	pi.registerCommand("recap", {
		description: "What the agent did in this run so far, or in the last one",
		handler: async (_args, ctx) => {
			const recap = run ? finish(run, Date.now()) : (last ?? stored(ctx));
			ctx.ui.notify(recap ? lines(recap, undefined, Number.POSITIVE_INFINITY).join("\n") : "Nothing to recap yet.", "info");
		},
	});
}
