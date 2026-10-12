/**
 * Test helpers shared by the packages in this folder. Both run the real `pi` binary with a
 * scripted model (see faux.ts) in an empty agent directory, so the user's own settings,
 * extensions and credentials are never involved.
 *
 * - runJson: headless, returns the JSON event stream.
 * - runTui: the real terminal UI inside a private tmux server, for what only exists on screen.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FLAGS = ["--offline", "-ne", "-ns", "-np", "-nc", "--no-themes", "--no-mcp", "--provider", "faux", "--model", "faux-1"];

export interface Seen {
	role: string;
	text: string;
}

function tempDir() {
	const dir = mkdtempSync(join(tmpdir(), "pi-test-"));
	process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** `from` reuses the directory of an earlier run, so its session can be resumed. */
function sandbox(script: string, from?: string) {
	const dir = from ?? tempDir();
	mkdirSync(join(dir, "cwd"), { recursive: true });
	mkdirSync(join(dir, "agent"), { recursive: true });
	const seenFile = join(dir, `seen-${script}.jsonl`);
	return {
		dir,
		cwd: join(dir, "cwd"),
		/** Sessions are saved inside the sandbox, which is deleted when the test process exits. */
		flags: [...FLAGS, "--session-dir", join(dir, "sessions"), ...(from ? ["-c"] : [])],
		env: { PI_CODING_AGENT_DIR: join(dir, "agent"), PI_TEST_SCRIPT: script, PI_TEST_SEEN: seenFile },
		/** One entry per model request: the messages it carried. */
		seen: (): Seen[][] => (existsSync(seenFile) ? readFileSync(seenFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
	};
}

const extensionFlags = (extensions: string[]) => extensions.flatMap((file) => ["-e", file]);

export function runJson(script: string, extensions: string[], prompts: string[], from?: string) {
	const box = sandbox(script, from);
	const pi = spawnSync("pi", [...box.flags, ...extensionFlags(extensions), "--mode", "json", ...prompts], {
		cwd: box.cwd,
		env: { ...process.env, ...box.env },
		encoding: "utf8",
		timeout: 60_000,
	});
	if (pi.status !== 0) throw new Error(`pi exited with ${pi.status}: ${pi.stderr}`);
	return { dir: box.dir, events: pi.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l)), seen: box.seen() };
}

export const hasTmux = spawnSync("tmux", ["-V"]).status === 0;

let servers = 0;

export function runTui(script: string, extensions: string[]) {
	const box = sandbox(script);
	const rawFile = join(box.dir, "raw.log");
	// A private server and no config file, so the user's own tmux is neither touched nor needed.
	const tmux = (...args: string[]) => spawnSync("tmux", ["-L", `pi-test-${process.pid}-${servers}`, "-f", "/dev/null", ...args], { encoding: "utf8" });
	servers++;
	const env = Object.entries(box.env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
	const started = tmux("new-session", "-d", "-s", "t", "-x", "100", "-y", "30", "-c", box.cwd, ...env, "pi", ...box.flags, ...extensionFlags(extensions));
	if (started.status !== 0) throw new Error(`tmux failed: ${started.stderr}`);
	// Everything pi writes, escape sequences included: tmux swallows the ones it does not draw.
	tmux("pipe-pane", "-t", "t", `cat >> '${rawFile}'`);
	const close = () => void tmux("kill-server");
	process.on("exit", close);

	const screen = () => tmux("capture-pane", "-t", "t", "-p").stdout;
	return {
		seen: box.seen,
		screen,
		raw: () => (existsSync(rawFile) ? readFileSync(rawFile, "utf8") : ""),
		/** Types text and presses Enter. */
		submit: (text: string) => {
			tmux("send-keys", "-t", "t", "-l", text);
			tmux("send-keys", "-t", "t", "Enter");
		},
		/** Sends named keys (Escape, Enter, Up...). */
		keys: (...keys: string[]) => void tmux("send-keys", "-t", "t", ...keys),
		/** Sends raw bytes, for sequences a terminal reports, such as focus changes. */
		bytes: (text: string) => void tmux("send-keys", "-t", "t", "-H", ...[...Buffer.from(text)].map((byte) => byte.toString(16))),
		/** Waits until the check passes; fails with the screen contents if it never does. */
		until: async (what: string, check: () => boolean, timeoutMs = 20_000) => {
			const deadline = Date.now() + timeoutMs;
			while (!check()) {
				if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. Screen:\n${screen()}`);
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		},
		close,
	};
}
