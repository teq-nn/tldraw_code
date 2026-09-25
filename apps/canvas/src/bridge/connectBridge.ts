import { DEFAULT_BRIDGE_PORT } from '@tldraw-code/protocol'
import type { Editor } from 'tldraw'
import { answeredQuestionCards, watchQuestionCards } from '../ask/watchQuestionCards'
import { ActivityTracker } from '../perception/activity'
import { pushActivityWhenQuiet } from '../perception/activityPush'
import { BridgeClient, type BridgeStatus } from './BridgeClient'
import { BASELINE_FLAVOUR, type LayoutFlavour } from './layoutFlavours'

export const DEFAULT_BRIDGE_URL = `ws://127.0.0.1:${DEFAULT_BRIDGE_PORT}`

export interface ConnectBridgeOptions {
	/** Defaults to {@link DEFAULT_BRIDGE_URL}. */
	url?: string
	/** Whose command handlers run the commands; defaults to {@link BASELINE_FLAVOUR}. */
	flavour?: LayoutFlavour
	onStatusChange?: (status: BridgeStatus) => void
	/** The server says Claude started or stopped working on a channel push (ADR 0025). */
	onAgentWorking?: (working: boolean) => void
}

/**
 * Connect a live tldraw `editor` to the MCP server's bridge: this is the
 * whole client side of the bridge (ADR 0002) as one imperative call, so both
 * the Vite canvas (`useCanvasBridge`, a thin React wrapper around this) and
 * the tldraw offline board script (which has no React tree of its own to
 * hang a hook off) run the exact same wiring. Returns a function that stops
 * the bridge and its watchers.
 */
export function connectBridge(editor: Editor, options: ConnectBridgeOptions = {}): () => void {
	const activity = new ActivityTracker(editor)
	const client = new BridgeClient({
		url: options.url ?? DEFAULT_BRIDGE_URL,
		handlers: (options.flavour ?? BASELINE_FLAVOUR).createHandlers(editor, { activity }),
		onStatusChange: (next) => {
			options.onStatusChange?.(next)
			// The server re-sends the flag when it hears our hello; until then, nothing is known.
			if (next !== 'connected') options.onAgentWorking?.(false)
			// Answers given while disconnected (or before a reconnect) reach the server now;
			// it ignores answers to questions it no longer waits for.
			if (next === 'connected') {
				for (const answered of answeredQuestionCards(editor)) {
					client.sendEvent('ask.answered', answered)
				}
			}
		},
		onAgentWorking: options.onAgentWorking,
	})
	const stopWatching = watchQuestionCards(editor, (askId, answer) =>
		client.sendEvent('ask.answered', { askId, answer }),
	)
	// Lets the server wake Claude when the user comments on the canvas (ADR 0024).
	const stopPushing = pushActivityWhenQuiet(editor, activity, (digest) =>
		client.sendEvent('canvas.activity', digest),
	)
	client.start()
	return () => {
		stopPushing()
		stopWatching()
		client.stop()
		activity.dispose()
	}
}
