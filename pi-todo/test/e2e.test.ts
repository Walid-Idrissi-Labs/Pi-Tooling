/**
 * Runs the real `pi` binary with the extension and a scripted model (see faux.ts), in an empty
 * agent directory so the user's own settings, extensions and credentials are not involved.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Item } from "../core.ts";

const root = join(import.meta.dirname, "..");

interface RunOptions {
	/** Reuse a directory from an earlier run, to resume its session. */
	dir?: string;
	session?: string[];
	/** Written to the isolated agent directory as settings.json. */
	settings?: object;
	/** Extra extension files, loaded before pi-todo. */
	extensions?: string[];
}

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "pi-todo-"));
	process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function run(script: string, prompts: string[], { dir = tempDir(), session = ["--no-session"], settings, extensions = [] }: RunOptions = {}) {
	const seenFile = join(dir, `${script}.seen.jsonl`);
	mkdirSync(join(dir, "cwd"), { recursive: true });
	mkdirSync(join(dir, "agent"), { recursive: true });
	if (settings) writeFileSync(join(dir, "agent", "settings.json"), JSON.stringify(settings));
	const pi = spawnSync(
		"pi",
		[
			...["--offline", "-ne", "-ns", "-np", "-nc", "--no-themes", "--no-mcp"],
			...[...extensions, join(root, "index.ts"), join(root, "test/faux.ts")].flatMap((file) => ["-e", file]),
			...["--provider", "faux", "--model", "faux-1", "--mode", "json", "--session-dir", join(dir, "sessions")],
			...session,
			...prompts,
		],
		{
			cwd: join(dir, "cwd"),
			env: { ...process.env, PI_CODING_AGENT_DIR: join(dir, "agent"), PI_TODO_SCRIPT: script, PI_TODO_SEEN: seenFile },
			encoding: "utf8",
			timeout: 60_000,
		},
	);
	assert.equal(pi.status, 0, `pi exited with ${pi.status}: ${pi.stderr}`);
	const events = pi.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
	assert.ok(events.some((e) => e.type === "agent_settled"), "the run never settled");
	const system = events.find((e) => e.type === "message_end" && e.message.role === "system")?.message;
	return {
		dir,
		/** What the model was offered: tool names, and the system prompt as stored. */
		tools: ((system?.toolsAdded ?? []) as { name: string }[]).map((tool) => tool.name),
		prompt: JSON.stringify(system?.sections ?? ""),
		/** Results of the model's own pi_todo calls, in order. */
		todo: events
			.filter((e) => e.type === "tool_execution_end" && e.toolName === "pi_todo")
			.map((e) => ({
				isError: e.isError as boolean,
				text: e.result.content[0].text as string,
				states: ((e.result.details?.items ?? []) as Item[]).map((i) => `${i.id}:${i.status}${i.verified ? "+checked" : ""}`).join(" "),
			})),
		// custom_message only: a user edit is stored under the same customType as a plain custom entry.
		nudges: events.filter((e) => e.type === "entry_appended" && e.entry.type === "custom_message" && e.entry.customType === "pi-todo").length,
		/** The last message the model was sent on each request. */
		seen: existsSync(seenFile) ? readFileSync(seenFile, "utf8").trim().split("\n") : [],
		/** The desktop notifications pi-todo asked for. */
		taps: existsSync(`${seenFile}.taps`) ? readFileSync(`${seenFile}.taps`, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [],
	};
}

test("a tick needs a passing check or a note, and the final sweep catches a regression", () => {
	const r = run("checks", ["go"]);
	assert.deepEqual(
		r.todo.map((t) => t.isError),
		[false, true, false, true, false, true, false],
	);
	assert.match(r.todo[1].text, /#1 is not done: its check failed/);
	assert.match(r.todo[3].text, /#2 has no check command, so pass note/);
	assert.match(r.todo[5].text, /final sweep found checks that no longer pass/);
	assert.equal(r.todo[5].states, "1:in_progress 2:done 3:done+checked");
	assert.match(r.todo[6].text, /All items are closed and every check still passes/);
	assert.equal(r.todo[6].states, "1:done+checked 2:done 3:done+checked");
	// The agent said "Finished." with two items open: it was sent back once, and saw why.
	assert.equal(r.nudges, 1);
	assert.match(r.seen[5], /still has open items:\\n#2 \[in_progress\] Review it\\n#3 \[pending\] Wrap up/);
});

test("an agent that makes no progress is let go after three reminders", () => {
	const r = run("stall", ["go"]);
	assert.equal(r.nudges, 3);
	assert.deepEqual(r.taps, [{ title: "stopped with 2 todo item(s) open", body: "#1 One, #2 Two" }]);
});

test("with a blocked item, one reminder is enough", () => {
	const r = run("blocked", ["go"]);
	assert.equal(r.nudges, 1);
	assert.match(r.seen[2], /Blocked #1\. Still open:\\n#2 \[pending\] Two/);
	assert.match(r.seen[3], /Blocked:\\n#1 \[blocked: needs the API key\] One/);
	// The user is told at once why an item is blocked, and again when the agent stops.
	assert.deepEqual(r.taps, [
		{ title: "todo blocked", body: "#1 One: needs the API key" },
		{ title: "stopped with 1 todo item(s) open", body: "#2 Two" },
	]);
});

test("the agent is told when the user edits the list", () => {
	const r = run("edit", ["go", "/pi-todo add Extra step", "carry on"]);
	const reminder = r.seen.find((s) => s.includes("The user added an item to the todo list."));
	assert.match(reminder ?? "", /#1 \[done\] One\\n#2 \[pending\] Extra step/);
	assert.equal(r.todo.at(-1)?.states, "1:done 2:done");
	assert.equal(r.nudges, 0);
});

test("a finished list is cleared when the next prompt starts", () => {
	const r = run("clear", ["go", "next task"]);
	assert.equal(r.todo.at(-1)?.text, "The list is empty.");
});

test("the model is shown the list again after ten requests without touching it", () => {
	const r = run("stale", ["go"]);
	const reminders = r.seen.flatMap((s, n) => (s.includes("has not changed for 10 requests") ? [n] : []));
	assert.deepEqual(reminders, [10]);
	assert.match(r.seen[10], /#1 \[in_progress\] One/);
});

test("the list is handed back to the model after compaction", () => {
	// Pi refuses to compact a session this small unless it may keep almost nothing verbatim.
	const r = run("compact", ["go", "/test-compact", "carry on"], { settings: { compaction: { keepRecentTokens: 1 } } });
	const reminder = r.seen.find((s) => s.includes("The conversation was compacted."));
	assert.match(reminder ?? "", /#1 \[done\] One\\n#2 \[blocked: needs the user\] Two/);
	assert.equal(r.todo.at(-1)?.text, "#1 [done] One\n#2 [blocked: needs the user] Two");
});

test("another extension's todo tool is hidden, so the model has one list to choose", () => {
	const rival = join(root, "test/rival.ts");
	const alone = run("clear", ["go"], { extensions: [rival] });
	assert.ok(alone.tools.includes("pi_todo"));
	assert.ok(!alone.tools.includes("todo"), `still offered: ${alone.tools}`);
	assert.doesNotMatch(alone.prompt, /Use the todo tool when/);
	assert.match(alone.prompt, /call pi_todo with action/);
});

test("the list survives into a resumed session", () => {
	const first = run("resume1", ["go"], { session: [] });
	const second = run("resume2", ["status?"], { dir: first.dir, session: ["-c"] });
	assert.equal(second.todo[0].text, "#1 [done] One\n#2 [blocked: needs the user] Two");
});
