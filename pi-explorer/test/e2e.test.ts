/**
 * Runs the real `pi` binary inside a private tmux server, 100 columns by 30 rows, and drives the
 * panel the way a terminal does: typed keys, and the byte sequences a mouse sends.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { hasTmux, runTui } from "../../testkit/pi.ts";

const root = join(import.meta.dirname, "..");
const extensions = [join(root, "index.ts"), join(root, "test/faux.ts")];
const skip = !hasTmux && "tmux is not installed";

type Pi = ReturnType<typeof runTui>;

/** src/ with two files, many/ with forty, and a README. */
function project(cwd: string) {
	mkdirSync(join(cwd, "src"));
	mkdirSync(join(cwd, "many"));
	mkdirSync(join(cwd, ".git"));
	for (const name of ["README.md", "src/index.ts", "src/my notes.md"]) writeFileSync(join(cwd, name), "");
	for (let n = 1; n <= 40; n++) writeFileSync(join(cwd, "many", `f${String(n).padStart(2, "0")}.txt`), "");
}

/** The panel sits in the last 32 of the 100 columns: column 69 is its rule, row 1 its header. */
const click = (pi: Pi, column: number, row: number) => {
	pi.bytes(`\x1b[<0;${column};${row}M`);
	pi.bytes(`\x1b[<0;${column};${row}m`);
};
/** How wide the conversation is drawn: the length of the rule above the prompt. */
const conversation = (pi: Pi) => pi.screen().match(/^─+/m)?.[0].length;
const shows = (pi: Pi, text: string) => pi.screen().includes(text);

test("docks beside the conversation and answers to clicks, the wheel and the disk", { skip }, async () => {
	const pi = runTui("tree", extensions);
	try {
		project(pi.cwd);
		await pi.until("pi to start", () => shows(pi, "faux-1"));
		assert.equal(conversation(pi), 100);

		pi.submit("/explorer");
		await pi.until("the panel", () => shows(pi, "README.md"));
		// The conversation made room, and git's own folder is not listed.
		assert.equal(conversation(pi), 68);
		assert.match(pi.screen(), /│ cwd +×\n.*│ ▸ many\n.*│ ▸ src\n.*│   README\.md/);
		assert.doesNotMatch(pi.screen(), /\.git/);

		// A click opens a folder; a click on a file puts a reference to it in the prompt.
		click(pi, 75, 3);
		await pi.until("src to open", () => shows(pi, "index.ts"));
		click(pi, 80, 5);
		await pi.until("the reference in the prompt", () => shows(pi, '@"src/my notes.md"'));
		pi.keys("C-u");

		// A file that appears on disk appears in the panel, with nothing asked.
		writeFileSync(join(pi.cwd, "src", "new.ts"), "");
		await pi.until("the new file", () => shows(pi, "new.ts"));

		// Forty files do not fit in thirty rows: the wheel brings the last one into view.
		click(pi, 75, 2);
		await pi.until("many to open", () => shows(pi, "f01.txt"));
		assert.equal(shows(pi, "f40.txt"), false);
		for (let n = 0; n < 30; n++) pi.bytes("\x1b[<65;75;10M");
		await pi.until("the last file", () => shows(pi, "f40.txt"));

		// The keyboard path: in, and back to the prompt with Escape.
		pi.submit("/explorer focus");
		await pi.until("the keys in the header", () => shows(pi, "↑↓ ←→ enter · esc"));
		pi.keys("Escape");
		await pi.until("the title back", () => /│ cwd +×/.test(pi.screen()));

		// The close button gives the columns back, and the panel reopens as it was left.
		click(pi, 100, 1);
		await pi.until("the panel to go", () => conversation(pi) === 100);
		pi.submit("/explorer");
		await pi.until("the open folders again", () => shows(pi, "f01.txt") && conversation(pi) === 68);
	} finally {
		pi.close();
	}
});

test("stays docked across a new session and a reload", { skip }, async () => {
	const pi = runTui("tree", extensions);
	try {
		project(pi.cwd);
		await pi.until("pi to start", () => shows(pi, "faux-1"));
		pi.submit("/explorer");
		await pi.until("the panel", () => shows(pi, "README.md"));

		// Pi takes the panel down with the old session and with the old code. It must come back, and still work.
		const works = async (after: string) => {
			await pi.until(`the panel after ${after}`, () => conversation(pi) === 68 && shows(pi, "▸ src"));
			click(pi, 75, 3);
			await pi.until(`src to open after ${after}`, () => shows(pi, "index.ts"));
			click(pi, 75, 3);
			await pi.until(`src to close after ${after}`, () => !shows(pi, "index.ts"));
		};

		pi.submit("hello");
		await pi.until("the reply", () => shows(pi, "Reply."));
		pi.submit("/new");
		await pi.until("the new session", () => !shows(pi, "Reply."));
		await works("/new");

		pi.submit("/reload");
		await pi.until("the reload", () => shows(pi, "Reloaded keybindings"));
		await works("/reload");
	} finally {
		pi.close();
	}
});

test("in a narrow terminal it opens in front, and still answers to clicks", { skip }, async () => {
	const pi = runTui("tree", extensions, { columns: 70 });
	try {
		project(pi.cwd);
		await pi.until("pi to start", () => shows(pi, "faux-1"));
		pi.submit("/explorer");
		await pi.until("the panel", () => shows(pi, "↑↓ ←→ enter · esc"));
		// Over the conversation, in the last 32 of the 70 columns.
		assert.equal(conversation(pi), 70);

		click(pi, 45, 3);
		await pi.until("src to open", () => shows(pi, "index.ts"));
		click(pi, 50, 4);
		await pi.until("the reference in the prompt", () => shows(pi, "@src/index.ts"));
		assert.equal(shows(pi, "↑↓ ←→ enter · esc"), false, "picking closes the panel");

		pi.keys("C-u");
		pi.submit("/explorer");
		await pi.until("the panel again", () => shows(pi, "↑↓ ←→ enter · esc"));
		click(pi, 70, 1);
		await pi.until("the panel to go", () => !shows(pi, "↑↓ ←→ enter · esc"));
	} finally {
		pi.close();
	}
});

test("opens in front, with the keyboard, where it cannot dock", { skip }, async () => {
	const pi = runTui("tree", extensions, { settings: { tuiMode: "regular" } });
	try {
		project(pi.cwd);
		await pi.until("pi to start", () => shows(pi, "faux-1"));
		pi.submit("/explorer");
		await pi.until("the panel", () => shows(pi, "↑↓ ←→ enter · esc"));
		// In front of the conversation, which keeps its width.
		assert.equal(conversation(pi), 100);

		// many, src, README.md: down to src, open it, down to its first file, pick it.
		pi.keys("Down", "Right");
		await pi.until("src to open", () => shows(pi, "index.ts"));
		pi.keys("Down", "Enter");
		await pi.until("the reference in the prompt", () => shows(pi, "@src/index.ts"));
		assert.equal(shows(pi, "↑↓ ←→ enter · esc"), false, "picking closes the panel");

		// The cursor stays on its file when another one appears above it: Enter must not pick the newcomer.
		pi.keys("C-u");
		pi.submit("/explorer");
		await pi.until("the panel again", () => shows(pi, "↑↓ ←→ enter · esc"));
		pi.keys("Down", "Down", "Down", "Down");
		await pi.until("the cursor on README.md", () => /›\s+README\.md/.test(pi.screen()));
		writeFileSync(join(pi.cwd, "AAA.txt"), "");
		await pi.until("the new file", () => shows(pi, "AAA.txt"));
		pi.keys("Enter");
		await pi.until("the reference in the prompt", () => shows(pi, "@README.md"));

		pi.keys("C-u");
		pi.submit("/explorer");
		await pi.until("the panel once more", () => shows(pi, "↑↓ ←→ enter · esc"));
		pi.keys("Escape");
		await pi.until("the panel to go", () => !shows(pi, "↑↓ ←→ enter · esc"));
	} finally {
		pi.close();
	}
});
