import assert from "node:assert/strict";
import { test } from "node:test";
import { clamp, entries, type Fit, mention, type Paint, parentRow, reveal, rows, same, type Tree, thumb, view } from "../core.ts";

const file = (name: string) => ({ name, dir: false });
const dir = (name: string) => ({ name, dir: true });
const names = (list: { path: string }[]) => list.map((entry) => entry.path);

const plain: Paint = { fg: (_color, text) => text, bg: (_color, text) => `[${text}]`, bold: (text) => text };
const fit: Fit = (text, width, pad) => (text.length > width ? `${text.slice(0, width - 1)}…` : pad ? text.padEnd(width) : text);

/** src/ (with deep/ inside), docs/ and two files, as a folder read would leave them. */
function tree(open: string[]): Tree {
	return {
		open: new Set(open),
		children: new Map([
			["", entries("", [file("README.md"), dir("src"), file("package.json"), dir("docs")])],
			["src", entries("src", [file("index.ts"), dir("deep")])],
			["src/deep", entries("src/deep", [file("a10.ts"), file("a2.ts")])],
		]),
	};
}

test("a folder lists its folders first, then its files, in natural order, without git's store", () => {
	const list = entries("src", [file("b.ts"), file("a10.ts"), dir(".git"), file(".DS_Store"), dir("zeta"), file("a2.ts"), file("B.md"), dir("Alpha"), file(".env")]);
	assert.deepEqual(names(list), ["src/Alpha", "src/zeta", "src/.env", "src/a2.ts", "src/a10.ts", "src/B.md", "src/b.ts"]);
	assert.deepEqual([...new Set(list.map((entry) => entry.depth))], [1]);
	assert.equal(entries("", [file("x")])[0].depth, 0);
});

test("only what sits under open folders is on screen, and a folder reopens as it was", () => {
	assert.deepEqual(names(rows(tree([]))), ["docs", "src", "package.json", "README.md"]);
	assert.deepEqual(names(rows(tree(["src"]))), ["docs", "src", "src/deep", "src/index.ts", "package.json", "README.md"]);
	// Open inside a closed folder: hidden, and back when the parent opens again.
	assert.deepEqual(names(rows(tree(["src/deep"]))), ["docs", "src", "package.json", "README.md"]);
	const all = rows(tree(["src", "src/deep"]));
	assert.deepEqual(names(all), ["docs", "src", "src/deep", "src/deep/a2.ts", "src/deep/a10.ts", "src/index.ts", "package.json", "README.md"]);
	// The left arrow goes to the folder that holds the row, and stays put at the top level.
	assert.equal(parentRow(all, 4), 2);
	assert.equal(parentRow(all, 2), 1);
	assert.equal(parentRow(all, 6), 6);
});

test("a fresh read counts as a change only when a name came, went or changed kind", () => {
	const before = entries("", [file("a"), dir("b")]);
	assert.equal(same(before, entries("", [dir("b"), file("a")])), true);
	assert.equal(same(before, entries("", [file("a"), dir("b"), file("c")])), false);
	assert.equal(same(before, entries("", [file("a"), file("b")])), false);
	assert.equal(same(undefined, []), false);
});

test("scrolling stays within the rows, follows the keyboard, and the thumb shows where you are", () => {
	assert.equal(clamp(-3, 50, 10), 0);
	assert.equal(clamp(45, 50, 10), 40);
	assert.equal(clamp(5, 4, 10), 0);
	assert.equal(reveal(10, 4, 10), 4);
	assert.equal(reveal(10, 25, 10), 16);
	assert.equal(reveal(10, 15, 10), 10);
	assert.deepEqual(thumb(0, 5, 10), [0, 0]);
	assert.deepEqual(thumb(0, 100, 10), [0, 1]);
	assert.deepEqual(thumb(90, 100, 10), [9, 10]);
	assert.deepEqual(thumb(10, 20, 10), [5, 10]);
});

test("a picked file becomes a file reference, quoted when its path has a space", () => {
	assert.equal(mention("src/index.ts"), "@src/index.ts ");
	assert.equal(mention("docs/my notes.md"), '@"docs/my notes.md" ');
});

test("the panel draws a header and one line per visible row, never wider than it is given", () => {
	const shown = tree(["src"]);
	const base = { title: "my-project", rows: rows(shown), open: shown.open, offset: 0 };
	assert.deepEqual(view(base, 20, 30, plain, fit), [
		"│ my-project       ×",
		"│ ▸ docs",
		"│ ▾ src",
		"│   ▸ deep",
		"│     index.ts",
		"│   package.json",
		"│   README.md",
	]);

	// With the keyboard in it: the keys in the header, and a pointer on a row filled to the edge.
	assert.deepEqual(view({ ...base, cursor: 2 }, 20, 30, plain, fit).slice(0, 4), ["│ ↑↓ ←→ enter · e… ×", "│ ▸ docs", "│ ▾ src", "│›[  ▸ deep          ]"]);

	// Three rows of room for seven: the rule becomes a scrollbar, and long names are cut.
	const long = { ...base, rows: [...base.rows, ...entries("", [file("a-very-long-file-name.test.ts")])] };
	assert.deepEqual(view(long, 20, 4, plain, fit), ["│ my-project       ×", "┃ ▸ docs", "│ ▾ src", "│   ▸ deep"]);
	assert.deepEqual(view({ ...long, offset: 4 }, 20, 4, plain, fit), ["│ my-project       ×", "│   package.json", "│   README.md", "┃   a-very-long-fil…"]);
	for (const line of view({ ...long, offset: 4 }, 20, 4, plain, fit)) assert.ok(line.length <= 20, line);

	// A name cannot smuggle an escape sequence onto the screen, and a sliver of a panel draws nothing.
	assert.deepEqual(view({ ...base, rows: entries("", [file("a\u001b[31m.ts")]) }, 20, 30, plain, fit)[1], "│   a�[31m.ts");
	assert.deepEqual(view(base, 7, 30, plain, fit), []);
});
