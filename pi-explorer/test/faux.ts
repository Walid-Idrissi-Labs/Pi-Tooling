/**
 * Test-only extension: the scripted model. The panel never calls it, but Pi needs one to start.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { say, scripted } from "../../testkit/faux.ts";

export default function (pi: ExtensionAPI) {
	scripted(pi, { tree: [say("Reply.")] });
}
