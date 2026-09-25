import type { BridgeStatus } from '../bridge/BridgeClient'

export interface BoardBridgeState {
	status: BridgeStatus
	working: boolean
}

const EVENT_NAME = 'tldraw-code:bridge-status'
const INITIAL_STATE: BoardBridgeState = { status: 'disconnected', working: false }

declare global {
	interface Window {
		__tldrawCodeBridgeState?: BoardBridgeState
	}
}

/**
 * A board script's `config.js` and `main.js` run as separate module graphs
 * with no shared module state (the tldraw offline board-script contract).
 * `config.js` owns the TopPanel component (the bridge pill); `main.js` owns
 * the live `BridgeClient`. `window` is the one thing both share for certain,
 * so it carries the bridge status between them: `main.js` publishes here on
 * every change, the pill (`BoardTopPanel`) subscribes.
 */
export function publishBridgeState(state: BoardBridgeState): void {
	window.__tldrawCodeBridgeState = state
	window.dispatchEvent(new CustomEvent<BoardBridgeState>(EVENT_NAME, { detail: state }))
}

/** The last published state, or the initial disconnected state before `main.js` has run. */
export function currentBridgeState(): BoardBridgeState {
	return window.__tldrawCodeBridgeState ?? INITIAL_STATE
}

/** Subscribe to every published state change. Returns an unsubscribe function. */
export function subscribeBridgeState(listener: (state: BoardBridgeState) => void): () => void {
	const handler = (event: Event) => listener((event as CustomEvent<BoardBridgeState>).detail)
	window.addEventListener(EVENT_NAME, handler)
	return () => window.removeEventListener(EVENT_NAME, handler)
}
