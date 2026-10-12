/**
 * Test-only extension: the scripted model. Main and side requests draw from the same queue, in
 * the order they are made.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { bash, say, scripted } from "../../testkit/faux.ts";

export default function (pi: ExtensionAPI) {
	scripted(pi, {
		// main, side, side follow-up, main
		side: [say("The capital of France is Paris."), say("About two million."), say("It was 2.8 million in 1954."), say("Continuing with the main task.")],
		// The side question arrives while the main agent is inside a tool call.
		busy: [bash("sleep 6"), say("Side answer: it is running sleep."), say("Main task finished.")],
		// A model failure on the side question must not reach the main conversation.
		broken: [say("Main reply.")],
		// Two side questions to browse afterwards.
		history: [say("Main reply."), say("First side answer."), say("Second side answer.")],
		// Two runs on one session file: the second must find the side thread the first one left.
		resume1: [say("The capital of France is Paris."), say("About two million.")],
		resume2: [say("It was 2.8 million in 1954.")],
	});
}
