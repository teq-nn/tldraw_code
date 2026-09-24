import type { EventEnvelope } from '@tldraw-code/protocol'
import type { AskClock } from '../src/ask'
import type { CanvasBridge } from '../src/bridge'

// Deterministic waiting for the tests: nothing here depends on how fast the
// machine is. Time-outs of `ask` fire when a test advances the manual clock,
// and every other wait ends on an observable condition or event.

interface Timer {
	at: number
	run: () => void
	every?: number
}

/** A clock for `ask` that only moves when {@link advance} is called. */
export class ManualClock implements AskClock {
	private time = 0
	private nextId = 1
	private readonly timers = new Map<number, Timer>()

	now(): number {
		return this.time
	}

	setTimeout(run: () => void, ms: number): unknown {
		return this.add({ at: this.time + ms, run })
	}

	setInterval(run: () => void, ms: number): unknown {
		return this.add({ at: this.time + ms, run, every: Math.max(1, ms) })
	}

	clearTimeout(handle: unknown): void {
		this.timers.delete(handle as number)
	}

	clearInterval(handle: unknown): void {
		this.timers.delete(handle as number)
	}

	/** Whether an `ask` call is waiting, i.e. its timeout is armed. */
	get armed(): boolean {
		return [...this.timers.values()].some((timer) => timer.every === undefined)
	}

	/** Resolves once an `ask` call has armed its timeout. */
	whenArmed(): Promise<void> {
		return waitFor(() => this.armed, 'an ask call to start waiting')
	}

	/** Move time forward, running every timer that falls due, in order. */
	advance(ms: number): void {
		const target = this.time + ms
		for (;;) {
			const due = [...this.timers.entries()]
				.filter(([, timer]) => timer.at <= target)
				.sort(([, a], [, b]) => a.at - b.at)[0]
			if (!due) break
			const [id, timer] = due
			this.time = timer.at
			if (timer.every === undefined) this.timers.delete(id)
			else timer.at += timer.every
			timer.run()
		}
		this.time = target
	}

	private add(timer: Timer): number {
		const id = this.nextId++
		this.timers.set(id, timer)
		return id
	}
}

/**
 * Wait until `condition` holds, polling on the event loop. The limit is a
 * safety net against hangs, far above any real wait, not a timing assumption.
 */
export async function waitFor(condition: () => boolean, what = 'condition'): Promise<void> {
	const deadline = Date.now() + 10_000
	while (!condition()) {
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
		await new Promise((resolve) => setTimeout(resolve, 2))
	}
}

/**
 * Resolves once the server has received the next canvas event named `name`.
 * Subscribe before sending: listeners run in subscription order, so by then
 * the server's own listeners (registered at start-up) have handled it.
 */
export function nextEvent(bridge: CanvasBridge, name: string): Promise<EventEnvelope> {
	return new Promise((resolve) => {
		const unsubscribe = bridge.onEvent((event) => {
			if (event.name !== name) return
			unsubscribe()
			resolve(event)
		})
	})
}
