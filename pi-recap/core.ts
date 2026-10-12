/**
 * pi-recap core: turns the events of one run into a short factual receipt.
 * No Pi imports, so it runs under plain `node --test`.
 */

import { relative, resolve } from "node:path";

/** Runs with fewer tool calls than this are short enough to read directly. */
export const MIN_TOOL_CALLS = 5;
/** pi-todo's tool: its results carry the checklist, which the recap sums up when present. */
const TODO_TOOL = "pi_todo";

export interface Recap {
	startedAt: number;
	endedAt: number;
	/** The agent's own tool calls, by tool. Calls that a tool makes itself are not counted. */
	tools: Record<string, number>;
	/** Files changed with the edit and write tools, in the order they were first touched. */
	files: { path: string; changes: number }[];
	commands: { run: number; failed: number; stillFailing: string[] };
	/** The checklist as pi-todo left it, when it was used. */
	todos?: { done: number; total: number; blocked: string[] };
	/** Titles of the dialogs the agent opened. */
	asked: string[];
}

/** A run in progress. `commands` maps each command to whether its last run failed. */
export interface Run {
	startedAt: number;
	tools: Record<string, number>;
	files: Record<string, number>;
	commands: Record<string, boolean>;
	commandsRun: number;
	commandsFailed: number;
	todos?: Recap["todos"];
	asked: string[];
}

export interface ToolEvent {
	toolName: string;
	input: Record<string, unknown>;
	details?: unknown;
	isError: boolean;
}

export const start = (now: number): Run => ({ startedAt: now, tools: {}, files: {}, commands: {}, commandsRun: 0, commandsFailed: 0, asked: [] });

function todosOf(details: unknown): Recap["todos"] {
	const items = (details as { items?: { status?: string; text?: string; note?: string }[] } | undefined)?.items;
	if (!Array.isArray(items)) return undefined;
	return {
		done: items.filter((i) => i.status === "done").length,
		total: items.filter((i) => i.status !== "dropped").length,
		blocked: items.filter((i) => i.status === "blocked").map((i) => `${i.text}${i.note ? `: ${i.note}` : ""}`),
	};
}

export function record(run: Run, event: ToolEvent, cwd: string): Run {
	const next: Run = { ...run, tools: { ...run.tools, [event.toolName]: (run.tools[event.toolName] ?? 0) + 1 } };
	if (event.toolName === "bash") {
		const command = String(event.input.command ?? "").trim();
		next.commandsRun++;
		if (event.isError) next.commandsFailed++;
		// Re-inserted so the map stays in order of last run; a later pass clears an earlier failure.
		const { [command]: _earlier, ...others } = run.commands;
		next.commands = { ...others, [command]: event.isError };
	} else if ((event.toolName === "edit" || event.toolName === "write") && !event.isError && typeof event.input.path === "string") {
		const inside = relative(cwd, resolve(cwd, event.input.path));
		const path = inside.startsWith("..") ? event.input.path : inside;
		next.files = { ...run.files, [path]: (run.files[path] ?? 0) + 1 };
	} else if (event.toolName === TODO_TOOL) {
		next.todos = todosOf(event.details) ?? run.todos;
	}
	return next;
}

export const asked = (run: Run, title: string): Run => ({ ...run, asked: [...run.asked, title] });

export const finish = (run: Run, now: number): Recap => ({
	startedAt: run.startedAt,
	endedAt: now,
	tools: run.tools,
	files: Object.entries(run.files).map(([path, changes]) => ({ path, changes })),
	commands: {
		run: run.commandsRun,
		failed: run.commandsFailed,
		stillFailing: Object.entries(run.commands).flatMap(([command, failed]) => (failed ? [command] : [])),
	},
	todos: run.todos,
	asked: run.asked,
});

const toolCalls = (recap: Recap) => Object.values(recap.tools).reduce((sum, n) => sum + n, 0);

export const worthIt = (recap: Recap) => toolCalls(recap) >= MIN_TOOL_CALLS;

/** The subset of Pi's Theme the receipt needs. */
export interface Paint {
	fg(color: "accent" | "dim" | "error" | "warning", text: string): string;
	bold(text: string): string;
}

export const PLAIN: Paint = { fg: (_color, text) => text, bold: (text) => text };

function duration(ms: number): string {
	const s = Math.max(0, Math.round(ms / 1000));
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function lines(recap: Recap, p: Paint = PLAIN, limit = 5): string[] {
	const { commands, todos } = recap;
	/** A labelled row. A list goes one entry per line under its label, so nothing is squeezed onto one. */
	const rows = (label: string, entries: string[], color?: "error" | "warning") => {
		const shown = entries.slice(0, limit).map((entry) => (color ? p.fg(color, entry) : entry));
		if (entries.length > limit) shown.push(p.fg("dim", `+${entries.length - limit} more`));
		return shown.map((entry, n) => `${p.fg("dim", (n ? "" : label).padEnd(9))}${entry}`);
	};
	const tools = Object.entries(recap.tools)
		.sort((a, b) => b[1] - a[1])
		.map(([name, n]) => `${name} ${n}`);
	return [
		`${p.fg("accent", p.bold("recap"))}${p.fg("dim", ` · ${duration(recap.endedAt - recap.startedAt)} · ${plural(toolCalls(recap), "tool call")}`)}`,
		...rows("changed", recap.files.map((f) => (f.changes > 1 ? `${f.path} ×${f.changes}` : f.path))),
		...(commands.run ? rows("ran", [`${plural(commands.run, "command")}${commands.failed ? `, ${commands.failed} failed` : ""}`]) : []),
		// The part worth reading first: what was failing when the agent stopped.
		...rows("failing", commands.stillFailing, "error"),
		...(todos ? rows("todos", [`${todos.done}/${todos.total} done`]) : []),
		...rows("blocked", todos?.blocked ?? [], "warning"),
		...rows("asked", recap.asked),
		// Counts, not a list to read: these stay on one line.
		...rows("tools", [p.fg("dim", tools.length > 6 ? `${tools.slice(0, 6).join(" · ")} · +${tools.length - 6} more` : tools.join(" · "))]),
	];
}
