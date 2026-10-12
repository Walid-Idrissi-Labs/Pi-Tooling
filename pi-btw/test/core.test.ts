import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { type Exchange, request, textOf } from "../core.ts";

const answer = (...parts: AssistantMessage["content"]) => ({ role: "assistant", content: parts }) as AssistantMessage;

test("a side question carries the conversation as a record and earlier side turns as a thread", () => {
	const thread: Exchange[] = [{ question: "first?", answer: answer({ type: "text", text: "One." }) }];
	const sent = request("[User]: build it\n\n[Assistant]: Building.", thread, "second?", 42);

	assert.match(sent.systemPrompt, /not a request: do not continue it/);
	assert.match(sent.systemPrompt, /You have no tools/);
	assert.ok(sent.systemPrompt.endsWith("<conversation>\n[User]: build it\n\n[Assistant]: Building.\n</conversation>"));
	assert.deepEqual(
		sent.messages.map((m) => [m.role, m.role === "user" ? m.content : "kept as returned"]),
		[
			["user", [{ type: "text", text: "first?" }]],
			["assistant", "kept as returned"],
			["user", [{ type: "text", text: "second?" }]],
		],
	);
	assert.equal(sent.messages[1], thread[0].answer);
	assert.match(request("", [], "anything?").systemPrompt, /<conversation>\n\(nothing yet\)\n<\/conversation>$/);
});

test("the shown answer is the text of the reply, without its thinking", () => {
	assert.equal(textOf(answer({ type: "thinking", thinking: "hm" } as never, { type: "text", text: " Paris. " }, { type: "text", text: "Population 2M." })), "Paris. \nPopulation 2M.");
});
