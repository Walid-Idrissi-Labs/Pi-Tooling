/**
 * Test helper, loaded inside Pi by each package's test extension: replaces the model with Pi's
 * scripted faux provider, so end-to-end tests run offline and cost nothing.
 *
 * PI_TEST_SCRIPT picks the script. PI_TEST_SEEN, when set, receives one JSON line per model
 * request: the messages that request carried, as [{ role, text }].
 */

import { appendFileSync } from "node:fs";
import { type AssistantMessage, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const say = (text: string) => fauxAssistantMessage(text);
export const call = (tool: string, args: Parameters<typeof fauxToolCall>[1] = {}) => fauxAssistantMessage(fauxToolCall(tool, args), { stopReason: "toolUse" });
export const bash = (command: string) => call("bash", { command });

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => (part?.type === "text" ? part.text : part?.type === "toolCall" ? `[tool call ${part.name}]` : "")).join("");
}

export function scripted(pi: ExtensionAPI, scripts: Record<string, AssistantMessage[]>) {
	const faux = fauxProvider();
	const seen = process.env.PI_TEST_SEEN;
	faux.setResponses(
		(scripts[process.env.PI_TEST_SCRIPT ?? ""] ?? []).map((message) => (context) => {
			if (seen) appendFileSync(seen, `${JSON.stringify(context.messages.map((m) => ({ role: m.role, text: textOf(m.content) })))}\n`);
			return message;
		}),
	);
	pi.registerProvider(faux.provider);

	// The built-in /compact lives in the interactive UI, so tests compact through the extension API.
	// Pi refuses to compact a tiny session unless settings.json has { compaction: { keepRecentTokens: 1 } }.
	pi.registerCommand("test-compact", {
		handler: (_args, ctx) => new Promise<void>((resolve, reject) => ctx.compact({ onComplete: () => resolve(), onError: reject })),
	});
}
