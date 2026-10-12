/**
 * pi-todo - a checklist the agent follows and the user watches.
 *
 * - `pi_todo` tool: plan a list, then tick items one by one.
 * - A tick means verified: an item's check command is run here, not by the agent, and must
 *   exit 0. Items without one need a note saying what was verified.
 * - The run cannot end while workable items remain.
 * - `/pi-todo` lets the user edit the list.
 *
 * State lives in the session (tool-result details, plus custom entries for user edits), so it
 * follows /reload, resume, compaction and branch navigation, and leaves no files in the repo.
 */

import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	add,
	close,
	count,
	finish,
	fromEditText,
	get,
	type Item,
	isOpen,
	isUnresolved,
	line,
	listText,
	PLAIN,
	panel,
	plan,
	reopen,
	start,
	toEditText,
} from "./core.ts";

const NAME = "pi-todo";
// Not "todo": Pi keeps only the first tool registered under a name, and other todo extensions use that one.
const TOOL = "pi_todo";
/** The name most other todo extensions give their tool. */
const RIVAL_TOOL = "todo";
/** Emitted on pi.events when the user is needed. pi-shoulder-tap turns it into a desktop notification; without it nothing happens. */
const TAP_EVENT = "shoulder-tap";
// shortcut: one timeout for every check command; make it per item if a test suite needs longer.
const CHECK_TIMEOUT_S = 600;
/** Model requests without a todo call before the list is shown to the model again. */
const STALE_AFTER = 10;
/** Reminders in a row without a newly closed item before the run is allowed to end. */
const MAX_STALLS = 3;

interface Snapshot {
	items: Item[];
}

const Params = Type.Object({
	action: StringEnum(["plan", "add", "start", "done", "block", "drop", "list"] as const),
	items: Type.Optional(
		Type.Array(
			Type.Object({
				text: Type.String({ description: "One concrete step, imperative, short" }),
				check: Type.Optional(Type.String({ description: "Shell command that exits 0 only once this step is really done" })),
			}),
			{ description: "plan, add: the steps in order" },
		),
	),
	id: Type.Optional(Type.Number({ description: "start, done, block, drop: the item id" })),
	note: Type.Optional(
		Type.String({
			description:
				"done: what you verified and how (required when the item has no check). block, drop: why. plan: why open items are being replaced.",
		}),
	),
});

export default function (pi: ExtensionAPI) {
	let items: Item[] = [];
	let auto = true;
	let stalls = 0;
	let lastClosed = -1;
	let sinceTodo = 0;
	let remind: string | undefined;
	/** Set while the agent is working on a prompt. */
	let runningSince: number | undefined;

	const show = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const { done, total } = count(items);
		ctx.ui.setStatus(NAME, items.length ? `☑ ${done}/${total}` : undefined);
		if (!items.length) ctx.ui.setWidget(NAME, undefined);
		else if (ctx.mode === "tui")
			ctx.ui.setWidget(NAME, (_tui, theme) => ({
				// Built on every frame, so the elapsed time stays live.
				render: (width) => panel(items, theme, { auto, runningSince }).map((l) => truncateToWidth(` ${l}`, width)),
				invalidate() {},
			}));
		else ctx.ui.setWidget(NAME, panel(items, PLAIN, { auto }));
	};

	const restore = (ctx: ExtensionContext) => {
		items = [];
		stalls = 0;
		lastClosed = -1;
		sinceTodo = 0;
		remind = undefined;
		// Last snapshot on the active branch wins, whether the agent or the user wrote it.
		for (const entry of ctx.sessionManager.getBranch()) {
			const snapshot =
				entry.type === "custom" && entry.customType === NAME
					? (entry.data as Snapshot | undefined)
					: entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === TOOL
						? (entry.message.details as Snapshot | undefined)
						: undefined;
			if (snapshot?.items) items = snapshot.items;
		}
		show(ctx);
	};

	const saveUserEdit = (ctx: ExtensionContext, next: Item[], what: string) => {
		items = next;
		pi.appendEntry<Snapshot>(NAME, { items });
		remind = `${what} Current list:`;
		show(ctx);
	};

	/** Runs through the bash tool, so permission and sandbox extensions see it like any agent command. */
	const runCheck = async (ctx: ExtensionToolContext, command: string, say: (text: string) => void) => {
		say(`$ ${command}`);
		const out = await ctx.executeTool("bash", { command, timeout: CHECK_TIMEOUT_S });
		const output = out.result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
		return { ok: !out.isError, output: output.trim().slice(-1500) };
	};

	/** After an item closes: says what is next, or runs the final sweep when nothing is left. */
	const afterClose = async (ctx: ExtensionToolContext, say: (text: string) => void, justRan?: string) => {
		const next = items.find((i) => i.status === "in_progress");
		if (next) return { text: `Next, now in progress: ${line(next)}` };
		const blocked = items.filter((i) => i.status === "blocked");
		if (blocked.length)
			return { text: `Nothing else can proceed. Blocked:\n${listText(blocked)}\nTell the user what you need from them, then stop.` };

		// Final sweep: a later item may have broken an earlier one.
		const checks = new Set(items.flatMap((i) => (i.status === "done" && i.check && i.check !== justRan ? [i.check] : [])));
		const failures: string[] = [];
		for (const command of checks) {
			const result = await runCheck(ctx, command, say);
			if (result.ok) continue;
			const ids = items.filter((i) => i.status === "done" && i.check === command).map((i) => i.id);
			items = reopen(items, ids);
			failures.push(`$ ${command}  (reopened ${ids.map((id) => `#${id}`).join(", ")})\n${result.output}`);
		}
		if (failures.length)
			return {
				failed: true,
				text: `The list is not finished: the final sweep found checks that no longer pass.\n${failures.join("\n\n")}\n\nOpen again:\n${listText(items.filter(isOpen))}`,
			};
		const proven = items.some((i) => i.status === "done" && i.check) ? " and every check still passes" : "";
		return {
			text: `All items are closed${proven}. Before you finish, re-read the user's original request: if anything in it is not covered, add items for it; otherwise give your final summary.`,
		};
	};

	pi.on("session_start", (_event, ctx) => {
		restore(ctx);
		// Two todo tools make the model choose by the user's wording, and the other tool's own
		// "use me for todos" rule tends to win. The agent gets one list: this one.
		const active = pi.getActiveTools();
		if (!active.includes(RIVAL_TOOL)) return;
		pi.setActiveTools(active.filter((name) => name !== RIVAL_TOOL));
		const from = pi.getAllTools().find((tool) => tool.name === RIVAL_TOOL)?.sourceInfo.source ?? "another extension";
		if (ctx.hasUI) ctx.ui.notify(`${NAME}: hid the "${RIVAL_TOOL}" tool of ${from}, so the agent has one todo list`, "info");
	});
	pi.on("session_tree", (_event, ctx) => restore(ctx));

	pi.on("session_compact", () => {
		if (items.some(isUnresolved)) remind = "The conversation was compacted. Your todo list:";
	});

	pi.on("agent_start", () => {
		runningSince ??= Date.now();
	});
	pi.on("agent_settled", (_event, ctx) => {
		runningSince = undefined;
		show(ctx);
	});

	pi.on("before_agent_start", (_event, ctx) => {
		stalls = 0;
		lastClosed = -1;
		// A finished list stays on screen until the next request starts.
		if (items.length && !items.some(isUnresolved)) {
			items = [];
			pi.appendEntry<Snapshot>(NAME, { items });
			show(ctx);
		}
	});

	// Reminders ride on one request only: never stored, so they cannot pile up or break the prompt cache.
	pi.on("context", (event) => {
		if (!remind && items.some(isOpen) && ++sinceTodo >= STALE_AFTER)
			remind = `The todo list has not changed for ${STALE_AFTER} requests. Mark items done as you finish them. Current list:`;
		if (!remind) return;
		const text = `<system-reminder>\n${remind}\n${items.length ? listText(items) : "(empty)"}\n</system-reminder>`;
		remind = undefined;
		sinceTodo = 0;
		return { messages: [...event.messages, { role: "user", content: text, timestamp: Date.now() }] };
	});

	// The agent is about to stop. With workable items left, send it back to work.
	pi.on("agent_before_settle", (event, ctx) => {
		const open = items.filter(isOpen);
		if (!auto || event.outcome !== "completed" || !open.length) return;
		const blocked = items.filter((i) => i.status === "blocked");
		const closed = items.length - open.length;
		stalls = closed > lastClosed ? 0 : stalls + 1;
		lastClosed = closed;
		// With a blocked item the agent may truly be stuck, so one reminder is enough.
		if (stalls >= (blocked.length ? 1 : MAX_STALLS)) {
			if (ctx.hasUI) ctx.ui.notify(`${NAME}: let the agent stop with ${open.length} item(s) open, no progress after ${stalls} reminder(s)`, "warning");
			pi.events.emit(TAP_EVENT, { title: `stopped with ${open.length} todo item(s) open`, body: open.map((i) => `#${i.id} ${i.text}`).join(", ") });
			return;
		}
		const content = [
			"You stopped, but the todo list still has open items:",
			listText(open),
			...(blocked.length
				? ["Blocked:", listText(blocked), "Continue with the items that do not depend on those. If none can proceed, tell the user what you need and stop."]
				: []),
			`Keep working through them. If one cannot be finished, call ${TOOL} with action "block" (it needs the user) or "drop" (no longer needed) and a note saying why.`,
		].join("\n");
		return {
			entries: [...event.entries, { type: "custom_message", customType: NAME, content, display: true, details: { open: open.length } }],
			continue: true,
		};
	});

	pi.registerMessageRenderer<{ open: number }>(NAME, (message, { outputPad }, theme) => {
		return new Text(theme.fg("dim", `↻ ${message.details?.open ?? "some"} todo item(s) still open, continuing`), outputPad, 0);
	});

	pi.registerTool({
		name: TOOL,
		label: "Todo",
		description:
			"Checklist for the task you are working on, shown live to the user. Actions: plan (set the list), add (append items), start / done / block / drop (one item by id), list.",
		promptSnippet: "Plan multi-step work as a checklist the user watches, and tick items as you verify them",
		promptGuidelines: [
			`For work with 3 or more steps, call ${TOOL} with action "plan" before starting. Mark each item done as soon as you have verified it, not in a batch at the end.`,
			`Give a ${TOOL} item a check command whenever a command can prove it (tests, build, lint, grep). The tool runs it and only accepts done if it exits 0.`,
			`You cannot finish while ${TOOL} items are open. If an item cannot be completed, block it (it needs the user) or drop it (no longer needed), with a note saying why.`,
		],
		parameters: Params,
		// Calls share the list, so two in one turn must not interleave.
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			sinceTodo = 0;
			const say = (text: string) => onUpdate?.({ content: [{ type: "text", text }], details: { items } });
			let text: string;
			let failed = false;

			switch (params.action) {
				case "plan": {
					const replaced = items.filter(isUnresolved).length;
					items = plan(items, params.items, params.note);
					text = `Planned ${items.length} item(s), ids 1-${items.length}.${replaced ? ` Replaced ${replaced} open item(s).` : ""} Now in progress: ${line(items[0])}`;
					break;
				}
				case "add": {
					const before = items.length;
					items = add(items, params.items);
					text = `Added:\n${listText(items.slice(before))}`;
					break;
				}
				case "start":
					items = start(items, params.id);
					text = `Now in progress: ${line(get(items, params.id))}`;
					break;
				case "done": {
					const item = get(items, params.id);
					if (item.status === "done") throw new Error(`#${item.id} is already done.`);
					if (item.check) {
						const result = await runCheck(ctx, item.check, say);
						if (!result.ok) throw new Error(`#${item.id} is not done: its check failed.\n$ ${item.check}\n${result.output}`);
					} else if (!params.note?.trim()) {
						throw new Error(`#${item.id} has no check command, so pass note: what you verified and how (command run, output seen, file read).`);
					}
					items = finish(items, item.id, { verified: !!item.check, note: params.note });
					const after = await afterClose(ctx, say, item.check);
					failed = !!after.failed;
					text = `Done #${item.id}. ${after.text}`;
					break;
				}
				case "block": {
					items = close(items, params.id, "blocked", params.note);
					const blocked = get(items, params.id);
					pi.events.emit(TAP_EVENT, { title: "todo blocked", body: `#${blocked.id} ${blocked.text}: ${blocked.note}` });
					const open = items.filter(isOpen);
					text = open.length
						? `Blocked #${params.id}. Still open:\n${listText(open)}\nStart one that does not depend on it, or tell the user what you need and stop.`
						: `Blocked #${params.id}. Tell the user what you need from them, then stop.`;
					break;
				}
				case "drop": {
					items = close(items, params.id, "dropped", params.note);
					const after = await afterClose(ctx, say);
					failed = !!after.failed;
					text = `Dropped #${params.id}. ${after.text}`;
					break;
				}
				case "list":
					text = items.length ? listText(items) : "The list is empty.";
					break;
			}

			show(ctx);
			return { content: [{ type: "text", text }], details: { items }, isError: failed };
		},

		renderCall(args, theme) {
			const target = args.id !== undefined ? ` #${args.id}` : args.items ? ` ${args.items.length} item(s)` : "";
			return new Text(theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action ?? "") + theme.fg("accent", target), 0, 0);
		},

		renderResult(result, { expanded, isPartial }, theme, context) {
			const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
			// The panel already shows the list, so a successful call takes no extra line unless expanded.
			if (!context.isError && !expanded && !isPartial) return new Text("", 0, 0);
			const shown = expanded || isPartial ? text : text.split("\n").slice(0, 2).join("\n");
			return new Text(theme.fg(context.isError ? "error" : "dim", shown), 0, 0);
		},
	});

	pi.registerCommand(NAME, {
		description: "Edit the todo list. Also: add <text>, clear, auto (toggle keep-going)",
		getArgumentCompletions: (prefix) => {
			// Nothing once a word is complete: an open suggestion would make Enter accept it instead of running the command.
			const matches = ["add ", "clear", "auto"].filter((value) => value.startsWith(prefix) && value !== prefix);
			return matches.length ? matches.map((value) => ({ value, label: value.trim() })) : null;
		},
		handler: async (args, ctx) => {
			const [verb, ...rest] = args.trim().split(/\s+/);
			const text = rest.join(" ");
			if (verb === "add" && text) return saveUserEdit(ctx, fromEditText(`${toEditText(items)}\n${text}`, items), "The user added an item to the todo list.");
			if (verb === "clear") return saveUserEdit(ctx, [], "The user cleared the todo list.");
			if (verb === "auto") {
				auto = !auto;
				show(ctx);
				return ctx.ui.notify(`${NAME}: keep-going is ${auto ? "on" : "off"}`, "info");
			}
			if (verb) return ctx.ui.notify(`Usage: /${NAME} [add <text> | clear | auto]`, "warning");
			if (!ctx.hasUI) return;
			const edited = await ctx.ui.editor(NAME, toEditText(items));
			if (edited !== undefined) saveUserEdit(ctx, fromEditText(edited, items), "The user edited the todo list.");
		},
	});
}
