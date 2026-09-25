import { type CanvasActivity, canvasEvents } from '@tldraw-code/protocol'
import { type AskClock, SYSTEM_CLOCK } from './ask'
import type { CanvasBridge } from './bridge'
import { describeActivity } from './perception'

/**
 * Declared on initialize: makes Claude Code treat this server as a channel,
 * so notifications it pushes reach Claude as `<channel>` messages (ADR 0024).
 * Claude Code only listens when started with the server opted in (during the
 * research preview: `--dangerously-load-development-channels server:tldraw-canvas`);
 * otherwise the pushes are dropped and the activity digest on tool results remains.
 */
export const CHANNEL_CAPABILITIES = { experimental: { 'claude/channel': {} } }

export const CHANNEL_NOTIFICATION = 'notifications/claude/channel'

/** How long Claude counts as working after a push when it makes no canvas tool call (ADR 0025). */
export const DEFAULT_WORKING_TIMEOUT_MS = 60_000

export interface ActivityChannelOptions {
	/** Time source of the working timeout; real timers by default. */
	clock?: AskClock
	workingTimeoutMs?: number
	log?: (message: string) => void
}

/** Sends one channel event into the Claude Code session. */
export type ChannelPush = (content: string, meta: Record<string, string>) => Promise<void>

/**
 * Pushes the user's canvas activity into the session (ADR 0024), so Claude
 * reacts to a sticky note without waiting for its next tool call.
 *
 * - Only a sticky note that addresses Claude with the `&agent` tag wakes it;
 *   the canvas decides that and reports it as `invoked`. Other activity, however
 *   large, waits for the next tool result or `read_canvas` (the user can leave
 *   notes without starting a turn).
 * - Nothing is pushed while a canvas tool call runs: its result ends with the
 *   same digest (ADR 0009), and a pending `ask` gets its answer on its own.
 * - The same digest is never reported twice: not after a tool result carried
 *   it, and not twice in a row. `read_canvas` starts afresh.
 * - Claude counts as working (ADR 0025) from a push until it has made a canvas
 *   tool call, or until a timeout when it makes none. The canvas is told on
 *   every change, and again when a tab connects in the middle of it.
 */
export class ActivityChannel {
	/** The digest Claude last got, by tool result or push; cleared when it reads the canvas. */
	private lastReported: string | undefined
	private busy = 0
	private working = false
	private workingTimer: unknown
	private readonly clock: AskClock
	private readonly workingTimeoutMs: number
	private readonly log: (message: string) => void

	constructor(
		private readonly bridge: CanvasBridge,
		private readonly push: ChannelPush,
		options: ActivityChannelOptions = {},
	) {
		this.clock = options.clock ?? SYSTEM_CLOCK
		this.workingTimeoutMs = options.workingTimeoutMs ?? DEFAULT_WORKING_TIMEOUT_MS
		this.log = options.log ?? (() => {})
		bridge.onEvent((event) => {
			if (event.name === 'hello' && this.working) {
				bridge.sendEvent('agent.working', { working: true })
				return
			}
			if (event.name !== 'canvas.activity') return
			const parsed = canvasEvents['canvas.activity'].safeParse(event.payload)
			if (!parsed.success) {
				this.log(`dropping malformed canvas.activity event: ${parsed.error.message}`)
				return
			}
			this.receive(parsed.data)
		})
	}

	/** Run a tool call; activity arriving meanwhile is left to its result's digest. */
	async whileBusy<T>(run: () => Promise<T>): Promise<T> {
		this.busy++
		try {
			return await run()
		} finally {
			this.busy--
			this.delivered()
		}
	}

	/** A tool result carried this digest to Claude. */
	reported(note: string): void {
		this.lastReported = note
	}

	/** Claude read the canvas: the next activity is new again. */
	read(): void {
		this.lastReported = undefined
	}

	/** A canvas tool call has delivered its result, or failed: Claude has reacted (ADR 0025). */
	delivered(): void {
		this.stopWorking()
	}

	private receive(activity: CanvasActivity): void {
		if (!activity.invoked) return
		if (this.busy > 0) return
		const note = describeActivity(activity)
		if (!note || note === this.lastReported) return
		this.lastReported = note
		// Working from the moment the push is sent, so a tool call that ends before the
		// send resolves still ends it; a push that fails never counts.
		this.startWorking()
		this.push(note, { event: 'canvas_activity' }).catch((error: Error) => {
			this.stopWorking()
			this.log(`could not push canvas activity: ${error.message}`)
		})
	}

	private startWorking(): void {
		this.clock.clearTimeout(this.workingTimer)
		this.workingTimer = this.clock.setTimeout(() => this.stopWorking(), this.workingTimeoutMs)
		this.setWorking(true)
	}

	private stopWorking(): void {
		this.clock.clearTimeout(this.workingTimer)
		this.workingTimer = undefined
		this.setWorking(false)
	}

	private setWorking(working: boolean): void {
		if (this.working === working) return
		this.working = working
		this.bridge.sendEvent('agent.working', { working })
	}
}
