/**
 * Test-only extension: stands in for another todo extension. Like the real ones, it registers a
 * tool named `todo` and tells the model to use it whenever the user mentions todos.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "todo",
		label: "Todo",
		description: "Manage a to-do list synced with Apple Reminders.",
		promptGuidelines: ["Use the todo tool when the user asks about tasks, todos, or reminders."],
		parameters: Type.Object({ action: Type.String() }),
		async execute() {
			return { content: [{ type: "text", text: "the other todo tool ran" }], details: undefined };
		},
	});
}
