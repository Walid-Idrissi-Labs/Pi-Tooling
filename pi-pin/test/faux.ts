/**
 * Test-only extension: the scripted model.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { bash, say, scripted } from "../../testkit/faux.ts";

export default function (pi: ExtensionAPI) {
	scripted(pi, {
		// One run of two requests, then a second run.
		pinned: [bash("true"), say("First reply."), say("Second reply.")],
		// Pin, work, then unpin everything.
		cleared: [say("First reply."), say("Second reply.")],
		// The compaction in between asks the model for a summary.
		compacted: [say("First reply."), say("Summary of the conversation so far."), say("Second reply.")],
		// Two runs on one session file: the second must still have the pin.
		resume1: [say("First reply.")],
		resume2: [say("Second reply.")],
		strip: [say("Reply.")],
	});
}
