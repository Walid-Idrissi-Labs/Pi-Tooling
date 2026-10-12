import assert from "node:assert/strict";
import { test } from "node:test";
import { asked, finish, lines, MIN_TOOL_CALLS, type Run, record, start, worthIt } from "../core.ts";

const tool = (toolName: string, input: Record<string, unknown> = {}, isError = false, details?: unknown) => ({ toolName, input, isError, details });
const replay = (events: ReturnType<typeof tool>[], run: Run = start(0)) => events.reduce((r, event) => record(r, event, "/repo"), run);

test("a command counts as still failing only if its last run failed", () => {
	const recap = finish(
		replay([
			tool("bash", { command: "npm test" }, true),
			tool("bash", { command: "npm run lint" }, true),
			tool("bash", { command: " npm test " }),
			tool("bash", { command: "npm run build" }),
			tool("bash", { command: "npm run build" }, true),
		]),
		1000,
	);
	assert.deepEqual(recap.commands, { run: 5, failed: 3, stillFailing: ["npm run lint", "npm run build"] });
	assert.deepEqual(recap.tools, { bash: 5 });
});

test("files are listed once, by path inside the project, and failed edits do not count", () => {
	const recap = finish(
		replay([
			tool("write", { path: "/repo/src/a.ts" }),
			tool("edit", { path: "src/a.ts" }),
			tool("edit", { path: "./src/a.ts" }, true),
			tool("write", { path: "/elsewhere/b.ts" }),
			tool("read", { path: "src/c.ts" }),
		]),
		1000,
	);
	assert.deepEqual(recap.files, [
		{ path: "src/a.ts", changes: 2 },
		{ path: "/elsewhere/b.ts", changes: 1 },
	]);
	assert.deepEqual(recap.tools, { write: 2, edit: 2, read: 1 });
});

test("the checklist is taken from the last pi-todo result", () => {
	const items = (...statuses: string[]) => ({ items: statuses.map((status, n) => ({ status, text: `step ${n + 1}`, note: status === "blocked" ? "needs a key" : undefined })) });
	const run = replay([tool("pi_todo", {}, false, items("in_progress", "pending", "pending")), tool("pi_todo", {}, false, items("done", "blocked", "dropped")), tool("pi_todo", {}, true)]);
	assert.deepEqual(finish(run, 0).todos, { done: 1, total: 2, blocked: ["step 2: needs a key"] });
});

test("a recap is kept only for runs with enough activity", () => {
	const calls = (n: number) => finish(replay(Array.from({ length: n }, () => tool("read"))), 0);
	assert.equal(worthIt(calls(MIN_TOOL_CALLS - 1)), false);
	assert.equal(worthIt(calls(MIN_TOOL_CALLS)), true);
});

test("the receipt reads top to bottom, one thing per line, with what is still failing called out", () => {
	let run = replay([
		tool("bash", { command: "npm test" }, true),
		tool("write", { path: "a.ts" }),
		tool("edit", { path: "a.ts" }),
		tool("write", { path: "b.ts" }),
		tool("read"),
		tool("read"),
		tool("pi_todo", {}, false, { items: [{ status: "done", text: "one" }, { status: "blocked", text: "two", note: "needs VPN" }] }),
	]);
	run = asked(run, "Deploy now?");
	assert.deepEqual(lines(finish(run, 125_000)), [
		"recap · 2m05s · 7 tool calls",
		"changed  a.ts ×2",
		"         b.ts",
		"ran      1 command, 1 failed",
		"failing  npm test",
		"todos    1/2 done",
		"blocked  two: needs VPN",
		"asked    Deploy now?",
		// Most used first; ties keep the order of first use.
		"tools    write 2 · read 2 · bash 1 · edit 1 · pi_todo 1",
	]);
	// A quiet run shows only what it has, and long lists say how much they left out.
	assert.deepEqual(lines(finish(replay([tool("read")]), 4000)), ["recap · 4s · 1 tool call", "tools    read 1"]);
	const many = finish(replay(["a", "b", "c", "d", "e", "f", "g"].map((name) => tool("write", { path: `${name}.ts` }))), 0);
	assert.deepEqual(lines(many).slice(1, 7), ["changed  a.ts", "         b.ts", "         c.ts", "         d.ts", "         e.ts", "         +2 more"]);
	assert.deepEqual(lines(many, undefined, Number.POSITIVE_INFINITY).slice(6, 8), ["         f.ts", "         g.ts"]);
});
