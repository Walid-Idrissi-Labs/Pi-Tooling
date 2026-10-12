/**
 * Test-only extension: a scripted model, plus stand-ins for the things that ask for a tap.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { call, say, scripted } from "../../testkit/faux.ts";

export default function (pi: ExtensionAPI) {
	scripted(pi, {
		taps: [say("First reply."), say("Second reply."), call("ask"), say("Third reply."), say("Fourth reply."), say("Fifth reply.")],
	});

	// Opens a dialog from inside a tool call, as an ask-the-user tool or a permission gate does.
	pi.registerTool({
		name: "ask",
		label: "Ask",
		description: "Ask the user to confirm.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const yes = await ctx.ui.confirm("Deploy now?", "The agent wants to deploy.");
			return { content: [{ type: "text", text: yes ? "yes" : "no" }], details: undefined };
		},
	});

	// Asks for a tap just before the run settles, as pi-todo does when it lets the agent stop with open items.
	let armed = false;
	pi.registerCommand("arm", { handler: async () => void (armed = true) });
	pi.on("agent_before_settle", () => {
		if (!armed) return;
		armed = false;
		pi.events.emit("shoulder-tap", { title: "todo blocked", body: "#3 Deploy; needs VPN access" });
	});
}
