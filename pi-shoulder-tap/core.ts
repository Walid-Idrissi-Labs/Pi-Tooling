/**
 * pi-shoulder-tap core: whether the user is here, and what to send the terminal when they are not.
 * No Pi imports, so it runs under plain `node --test`.
 */

/** What a terminal reports when its window gains or loses focus (Pi asks for these in fullscreen mode). */
export const FOCUS_IN = "\x1b[I";
export const FOCUS_OUT = "\x1b[O";

/** Without focus reports, input this recent means the user is still here. */
export const AWAY_AFTER_MS = 30_000;

export interface Presence {
	/** True once the terminal has reported a focus change. From then on `focused` is exact. */
	focusKnown: boolean;
	focused: boolean;
	lastInputAt: number;
}

export const arrived = (now: number): Presence => ({ focusKnown: false, focused: true, lastInputAt: now });

/** Takes one chunk of raw terminal input, which may hold several sequences. */
export function see(presence: Presence, input: string, now: number): Presence {
	const left = input.lastIndexOf(FOCUS_OUT);
	const back = input.lastIndexOf(FOCUS_IN);
	if (left >= 0 || back >= 0) return { ...presence, focusKnown: true, focused: back > left };
	// Not treated as proof of focus: a terminal can report mouse movement over a window that is in the background.
	return { ...presence, lastInputAt: now };
}

export const isPresent = (presence: Presence, now: number) =>
	presence.focusKnown ? presence.focused : now - presence.lastInputAt < AWAY_AFTER_MS;

const clean = (text: string, max: number) =>
	text
		.replace(/[\x00-\x1f\x7f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, max);

/**
 * The bytes that make the terminal show a desktop notification.
 * shortcut: OSC 777 only (Ghostty, iTerm2, WezTerm). Kitty wants OSC 99 and Windows Terminal a toast; Pi's notify.ts example has both.
 */
export function notification(title: string, body: string, insideTmux = false): string {
	// OSC 777 splits its fields on ";", so the title cannot contain one.
	const osc = `\x1b]777;notify;${clean(title, 80).replaceAll(";", ",")};${clean(body, 240)}\x07`;
	// The bell adds whatever the terminal does for one. In Ghostty: a dock bounce and a 🔔 on the tab until you return.
	const bell = "\x07";
	// tmux only forwards sequences it does not know when they are wrapped, with every ESC doubled.
	return insideTmux ? `\x1bPtmux;${osc.replaceAll("\x1b", "\x1b\x1b")}\x1b\\${bell}` : osc + bell;
}

/** A notification shows raw text: emphasis, code ticks, headings and bullets would only be noise in it. */
const unmark = (text: string) => text.replace(/\*\*|__|`/g, "").replace(/^\s*(#{1,6}|>|[-*])\s+/gm, "");

/** The text of the agent's last message: the most useful thing a "done" notification can say. */
export function lastWords(messages: readonly { role: string; content?: unknown }[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const { role, content } = messages[i];
		if (role !== "assistant" || !Array.isArray(content)) continue;
		const text = content
			.map((part: { type?: string; text?: string }) => (part?.type === "text" ? (part.text ?? "") : ""))
			.join(" ")
			.trim();
		if (text) return unmark(text);
	}
	return "";
}
