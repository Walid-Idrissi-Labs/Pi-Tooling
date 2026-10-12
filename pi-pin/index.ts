/**
 * pi-pin - instructions the agent cannot forget.
 *
 * `/pin <text>` pins an instruction for the session. Pinned instructions open every request the
 * model receives, so they survive compaction, and they are shown in a strip below the editor so
 * you remember what is in force. `/pin` alone edits them, `/pin clear` removes them all.
 *
 * Pins are stored in the session as custom entries; what the model sees is added to each request
 * and never stored.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { add, block, changeNote, fromEditText, strip, toEditText } from "./core.ts";

const NAME = "pi-pin";

export default function (pi: ExtensionAPI) {
	let pins: string[] = [];
	/** Set by an edit, cleared once the model has been told. */
	let changed = false;

	const show = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		if (!pins.length) ctx.ui.setWidget(NAME, undefined);
		else if (ctx.mode === "tui")
			ctx.ui.setWidget(
				NAME,
				(_tui, theme) => ({
					render: (width) => [truncateToWidth(` ${theme.fg("dim", strip(pins))}`, width)],
					invalidate() {},
				}),
				{ placement: "belowEditor" },
			);
		else ctx.ui.setWidget(NAME, [strip(pins)], { placement: "belowEditor" });
	};

	const restore = (ctx: ExtensionContext) => {
		pins = [];
		changed = false;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== NAME) continue;
			const stored = (entry.data as { pins?: string[] } | undefined)?.pins;
			if (stored) pins = stored;
		}
		show(ctx);
	};
	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));

	const save = (ctx: ExtensionContext, next: string[]) => {
		if (next.join("\n") === pins.join("\n")) return;
		pins = next;
		changed = true;
		pi.appendEntry(NAME, { pins });
		show(ctx);
	};

	// Added to each request and never stored: nothing piles up, and the opening block stays byte-identical for the prompt cache.
	pi.on("context", (event) => {
		if (!pins.length && !changed) return;
		const user = (content: string) => ({ role: "user" as const, content, timestamp: Date.now() });
		const messages = [...(pins.length ? [user(block(pins))] : []), ...event.messages, ...(changed ? [user(changeNote(pins))] : [])];
		changed = false;
		return { messages };
	});

	pi.registerCommand("pin", {
		description: "Pin an instruction for the session. Alone: edit the pins. clear: remove them all",
		// Nothing once the word is complete: an open suggestion would make Enter accept it instead of running the command.
		getArgumentCompletions: (prefix) => (prefix && prefix !== "clear" && "clear".startsWith(prefix) ? [{ value: "clear", label: "clear" }] : null),
		handler: async (args, ctx) => {
			const text = args.trim();
			if (text === "clear") return save(ctx, []);
			if (text) return save(ctx, add(pins, text));
			if (!ctx.hasUI) return;
			const edited = await ctx.ui.editor(NAME, toEditText(pins));
			if (edited !== undefined) save(ctx, fromEditText(edited));
		},
	});
}
