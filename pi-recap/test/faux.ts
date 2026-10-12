/**
 * Test-only extension: the scripted model, plus a tool that opens a dialog.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { bash, call, say, scripted } from "../../testkit/faux.ts";

export default function (pi: ExtensionAPI) {
	scripted(pi, {
		// A command that fails and is later fixed, one that stays broken, and a file written then edited.
		work: [
			bash("test -f flag.txt"),
			call("write", { path: "notes.md", content: "alpha\n" }),
			call("edit", { path: "notes.md", edits: [{ oldText: "alpha", newText: "beta" }] }),
			bash("touch flag.txt"),
			bash("test -f flag.txt"),
			bash("exit 3"),
			say("All done."),
			say("Second reply."),
		],
		// Too little to need a recap.
		short: [bash("true"), bash("true"), say("Done.")],
		// With pi-todo loaded: one item done, one blocked.
		todos: [
			call("pi_todo", { action: "plan", items: [{ text: "One" }, { text: "Two" }] }),
			call("pi_todo", { action: "done", id: 1, note: "checked by hand" }),
			bash("true"),
			bash("true"),
			call("pi_todo", { action: "block", id: 2, note: "needs the user" }),
			say("Waiting."),
		],
		// The agent opens a dialog along the way.
		asks: [call("ask"), bash("true"), bash("true"), bash("true"), bash("true"), say("Finished.")],
	});

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
}
