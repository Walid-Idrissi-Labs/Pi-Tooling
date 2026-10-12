/**
 * pi-btw - ask a side question without interrupting or polluting the main conversation.
 *
 * `/btw <question>` works while the agent is busy. The same model answers in a panel, with the
 * main conversation as read-only context and no tools. The main agent never sees the question
 * or the answer. Follow-ups continue the side thread, `/btw` alone shows the last answer again,
 * and `/btw history` lists every side question of the session.
 *
 * Exchanges are stored in the session as custom entries, which Pi never sends to the model, so
 * the history follows /reload, resume and branch navigation.
 */

import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { convertToLlm, getMarkdownTheme, serializeConversation } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown, matchesKey, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import { type Exchange, request, textOf } from "./core.ts";

const NAME = "pi-btw";

/** Takes the editor's place while a side answer is on screen. The transcript above keeps moving. */
class Panel implements Component {
	private readonly markdown = new Markdown("", 1, 0, getMarkdownTheme());
	private hasAnswer = false;
	/** "answering…" while the reply streams, or the error message once it has failed. */
	private note = "";
	private failed = false;
	private offset = 0;

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly question: string,
		private readonly close: () => void,
	) {}

	show(answer: string, note = "") {
		this.hasAnswer = answer.length > 0;
		this.markdown.setText(answer);
		this.note = note;
		this.tui.requestRender();
	}

	fail(message: string) {
		this.failed = true;
		this.note = message;
		this.tui.requestRender();
	}

	/** Rows for the answer: at most half the terminal, so the agent's work stays visible above. */
	private room() {
		return Math.max(3, Math.floor(this.tui.terminal.rows / 2) - 6);
	}

	handleInput(data: string) {
		// Escape lands here, not on the editor, so it closes the panel without interrupting the agent.
		if (matchesKey(data, "escape") || matchesKey(data, "enter") || matchesKey(data, "ctrl+c")) return this.close();
		const step = matchesKey(data, "up") ? -1 : matchesKey(data, "down") ? 1 : matchesKey(data, "pageUp") ? -this.room() : matchesKey(data, "pageDown") ? this.room() : 0;
		if (!step) return;
		this.offset = Math.max(0, this.offset + step);
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const th = this.theme;
		const rule = th.fg("borderMuted", "─".repeat(width));
		const body = this.failed
			? [truncateToWidth(` ${th.fg("error", this.note)}`, width)]
			: this.hasAnswer
				? this.markdown.render(width)
				: [` ${th.fg("dim", "thinking…")}`];
		const room = this.room();
		this.offset = Math.min(this.offset, Math.max(0, body.length - room));
		const shown = body.slice(this.offset, this.offset + room);
		const hints = [
			"esc close",
			...(this.note && !this.failed && this.hasAnswer ? [this.note] : []),
			...(body.length > room ? [`↑↓ scroll ${this.offset + 1}-${this.offset + shown.length} of ${body.length}`] : []),
		];
		// The question, the answer and the keys each stand apart, with a blank line between them.
		return [
			rule,
			truncateToWidth(` ${th.fg("accent", th.bold("btw"))} ${th.fg("muted", this.question)}`, width),
			"",
			...shown,
			"",
			truncateToWidth(th.fg("dim", ` ${hints.join(" · ")}`), width),
			rule,
		];
	}

	invalidate() {
		this.markdown.invalidate();
	}
}

export default function (pi: ExtensionAPI) {
	let thread: Exchange[] = [];

	const restore = (ctx: ExtensionContext) => {
		thread = ctx.sessionManager.getBranch().flatMap((entry) => (entry.type === "custom" && entry.customType === NAME && entry.data ? [entry.data as Exchange] : []));
	};
	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));

	const ask = async (ctx: ExtensionCommandContext, question: string, signal: AbortSignal | undefined, onText: (text: string) => void) => {
		if (!ctx.model) throw new Error("No model selected.");
		// shortcut: the conversation goes out as text, so each question re-reads it with no prompt-cache hit; replay the real messages if that cost matters.
		const conversation = serializeConversation(convertToLlm(ctx.sessionManager.buildSessionProjection().messages));
		const stream = ctx.modelRegistry.streamSimple(ctx.model, request(conversation, thread, question), {
			signal,
			reasoning: ctx.thinkingLevel === "off" ? undefined : ctx.thinkingLevel,
			// Its own exchange: it must not share the main session's provider-side state.
			sessionId: uuidv7(),
			cacheRetention: "none",
		});
		let text = "";
		for await (const event of stream) {
			if (event.type !== "text_delta") continue;
			text += event.delta;
			onText(text);
		}
		const answer = await stream.result();
		if (answer.stopReason === "error") throw new Error(answer.errorMessage ?? "The model returned an error.");
		if (answer.stopReason !== "aborted") {
			thread.push({ question, answer });
			// A custom entry: kept with the session, never part of what the model is sent.
			pi.appendEntry<Exchange>(NAME, { question, answer });
		}
		return textOf(answer);
	};

	const openPanel = (ctx: ExtensionCommandContext, question: string, fill: (panel: Panel, signal: AbortSignal) => void) =>
		ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
			const abort = new AbortController();
			const panel = new Panel(tui, theme, question, () => {
				abort.abort();
				done();
			});
			fill(panel, abort.signal);
			return panel;
		});

	/** A stored exchange: a panel in the terminal UI, a notification where there is no panel. */
	const showStored = async (ctx: ExtensionCommandContext, turn: Exchange) => {
		if (ctx.mode === "tui") await openPanel(ctx, turn.question, (panel) => panel.show(textOf(turn.answer)));
		else if (ctx.hasUI) ctx.ui.notify(textOf(turn.answer), "info");
	};

	const browse = async (ctx: ExtensionCommandContext) => {
		if (!thread.length) return ctx.ui.notify("No side questions in this session yet.", "info");
		// Newest first. The number keeps two identical questions apart and finds the exchange again.
		const options = thread.map((turn, n) => `${n + 1}. ${turn.question.replace(/\s+/g, " ").slice(0, 100)}`).reverse();
		for (;;) {
			const picked = await ctx.ui.select("btw history", options);
			if (!picked) return;
			await showStored(ctx, thread[Number.parseInt(picked, 10) - 1]);
		}
	};

	pi.registerCommand("btw", {
		description: "Ask a side question; the main conversation never sees it. Alone: the last answer again. history: all of them",
		// Nothing once the word is complete: an open suggestion would make Enter accept it instead of running the command.
		getArgumentCompletions: (prefix) => (prefix && prefix !== "history" && "history".startsWith(prefix) ? [{ value: "history", label: "history" }] : null),
		handler: async (args, ctx) => {
			const question = args.trim();
			if (question === "history") return browse(ctx);
			if (!question) {
				const last = thread.at(-1);
				return last ? showStored(ctx, last) : ctx.ui.notify("Usage: /btw <question>, or /btw history", "info");
			}

			if (ctx.mode !== "tui") {
				// No panel outside the terminal UI: the answer arrives as a notification where there is one.
				const answer = await ask(ctx, question, undefined, () => {}).catch((error: Error) => `btw failed: ${error.message}`);
				if (ctx.hasUI) ctx.ui.notify(answer, "info");
				return;
			}

			await openPanel(ctx, question, (panel, signal) => {
				ask(ctx, question, signal, (text) => panel.show(text, "answering…")).then(
					(text) => panel.show(text),
					(error: Error) => panel.fail(error.message),
				);
			});
		},
	});
}
