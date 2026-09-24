import { randomUUID } from 'node:crypto'
import {
	type AskAnswer,
	type CanvasEventPayload,
	canvasEvents,
	type Question,
} from '@tldraw-code/protocol'
import type { CanvasBridge } from './bridge'
import { ToolInputError } from './errors'

export interface AskTimings {
	/** How long one `ask` call waits for the user before returning "no answer yet". */
	timeoutMs: number
	/** Interval of the "still waiting" progress heartbeat while an `ask` call waits. */
	heartbeatMs: number
}

/** Ten minutes: long enough to think, short enough that Claude hears back within a coffee break (ADR 0006). */
export const DEFAULT_ASK_TIMINGS: AskTimings = { timeoutMs: 10 * 60_000, heartbeatMs: 15_000 }

export type AskOutcome =
	| {
			kind: 'answered'
			answer: AskAnswer
			/** The answer arrived while no call was waiting (after a timeout) and is delivered now. */
			buffered: boolean
	  }
	| { kind: 'timeout'; waitedMs: number }
	| { kind: 'cancelled' }

export interface AskCallOptions {
	/** Aborted when Claude Code cancels the tool call (e.g. the user pressed Esc). */
	signal?: AbortSignal
	/** Called every `heartbeatMs` while waiting, with the time waited so far. */
	onHeartbeat?: (waitedMs: number) => void
}

/** The question card currently on the canvas, as far as the server knows. */
interface OpenQuestion {
	askId: string
	question: Question
	/** An answer that arrived while no call was waiting; handed to the next matching call. */
	answer?: AskAnswer
}

interface Waiter {
	askId: string
	resolve: (answer: AskAnswer) => void
}

/**
 * Server side of `ask` (ADR 0006). Shows a question card via the quick
 * `ask.show` command, then waits for the canvas's `ask.answered` event.
 *
 * - At most one question is open, and at most one `ask` call waits at a time.
 * - After a timeout the card stays open. Asking the same question again
 *   re-attaches to that card (and returns an answer given meanwhile at once);
 *   asking a different question replaces the card.
 * - A canvas that disconnects while a call waits does not end the wait: the
 *   reloaded tab re-sends answers of the card it still shows.
 */
export class AskCoordinator {
	private open: OpenQuestion | undefined
	private waiter: Waiter | undefined
	/** The last question whose answer an `ask` call returned; its card may still be on the canvas. */
	private delivered: string | undefined

	constructor(
		private readonly bridge: CanvasBridge,
		private readonly timings: AskTimings = DEFAULT_ASK_TIMINGS,
		private readonly log: (message: string) => void = () => {},
	) {
		bridge.onEvent((event) => {
			if (event.name !== 'ask.answered') return
			const parsed = canvasEvents['ask.answered'].safeParse(event.payload)
			if (!parsed.success) {
				this.log(`dropping malformed ask.answered event: ${parsed.error.message}`)
				return
			}
			this.receive(parsed.data)
		})
	}

	async ask(question: Question, options: AskCallOptions = {}): Promise<AskOutcome> {
		if (this.waiter) {
			throw new ToolInputError(
				'ask_in_progress',
				'Another ask call is still waiting for the user. Ask one question at a time.',
			)
		}

		const open = this.open && sameQuestion(this.open.question, question) ? this.open : undefined
		if (open?.answer) {
			this.open = undefined
			this.delivered = open.askId
			return { kind: 'answered', answer: open.answer, buffered: true }
		}

		const askId = open?.askId ?? randomUUID()
		// The new card replaces the answered one, so there is nothing left to collapse.
		this.delivered = undefined
		// Show (or re-show, if the user deleted it) the card; returns quickly.
		await this.bridge.request('ask.show', {
			askId,
			question: question.question,
			options: question.options,
			recommendation: question.options.indexOf(question.recommendation),
		})
		this.open = { askId, question }
		return this.wait(askId, options)
	}

	/** Whether a question card is open (shown and not yet answered to a waiting call). */
	hasOpenQuestion(): boolean {
		return this.open !== undefined
	}

	/**
	 * The question whose answer Claude has received and whose card may still
	 * be on the canvas, i.e. the card `render_graph` may collapse (ADR 0010).
	 * Cards whose answer Claude has not seen yet are never offered, so
	 * collapsing cannot lose an answer.
	 */
	answeredQuestion(): string | undefined {
		return this.delivered
	}

	/** The answered card `askId` is gone from the canvas; stop offering it. */
	forgetAnsweredQuestion(askId: string): void {
		if (this.delivered === askId) this.delivered = undefined
	}

	private wait(askId: string, { signal, onHeartbeat }: AskCallOptions): Promise<AskOutcome> {
		const started = Date.now()
		return new Promise<AskOutcome>((resolve) => {
			const finish = (outcome: AskOutcome) => {
				clearTimeout(timer)
				clearInterval(heartbeat)
				signal?.removeEventListener('abort', onAbort)
				if (this.waiter?.askId === askId) this.waiter = undefined
				resolve(outcome)
			}
			const onAbort = () => finish({ kind: 'cancelled' })
			const timer = setTimeout(
				() => finish({ kind: 'timeout', waitedMs: Date.now() - started }),
				this.timings.timeoutMs,
			)
			const heartbeat = setInterval(
				() => onHeartbeat?.(Date.now() - started),
				this.timings.heartbeatMs,
			)
			if (signal?.aborted) return onAbort()
			signal?.addEventListener('abort', onAbort, { once: true })
			this.waiter = {
				askId,
				resolve: (answer) => finish({ kind: 'answered', answer, buffered: false }),
			}
		})
	}

	private receive({ askId, answer }: CanvasEventPayload<'ask.answered'>): void {
		const open = this.open
		if (!open || open.askId !== askId) {
			this.log(`ignoring answer for question ${askId}: it is not open`)
			return
		}
		if (answer.kind === 'option' && answer.option >= open.question.options.length) {
			this.log(`ignoring answer for question ${askId}: option ${answer.option} does not exist`)
			return
		}
		if (this.waiter?.askId === askId) {
			this.open = undefined
			this.delivered = askId
			this.waiter.resolve(answer)
			return
		}
		// Nobody is waiting (the last call timed out): keep the first answer for the next call.
		open.answer ??= answer
	}
}

function sameQuestion(a: Question, b: Question): boolean {
	return (
		a.question === b.question &&
		a.recommendation === b.recommendation &&
		a.options.length === b.options.length &&
		a.options.every((option, index) => option === b.options[index])
	)
}
