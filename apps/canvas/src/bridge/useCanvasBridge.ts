import { DEFAULT_BRIDGE_PORT } from '@tldraw-code/protocol'
import { useEffect, useState } from 'react'
import type { Editor } from 'tldraw'
import { answeredQuestionCards, watchQuestionCards } from '../ask/watchQuestionCards'
import { ActivityTracker } from '../perception/activity'
import { pushActivityWhenQuiet } from '../perception/activityPush'
import { BridgeClient, type BridgeStatus } from './BridgeClient'
import { BASELINE_FLAVOUR, type LayoutFlavour } from './layoutFlavours'

export const BRIDGE_URL: string =
	import.meta.env.VITE_CANVAS_BRIDGE_URL ?? `ws://127.0.0.1:${DEFAULT_BRIDGE_PORT}`

export interface CanvasBridgeState {
	status: BridgeStatus
	/** Claude is working on a channel push (ADR 0025); the server owns this state. */
	working: boolean
}

/**
 * Connect the given editor to the MCP server's bridge for as long as the
 * component is mounted, running the commands with the layout flavour's handlers.
 */
export function useCanvasBridge(
	editor: Editor | undefined,
	flavour: LayoutFlavour = BASELINE_FLAVOUR,
): CanvasBridgeState {
	const [status, setStatus] = useState<BridgeStatus>('disconnected')
	const [working, setWorking] = useState(false)

	useEffect(() => {
		if (!editor) return
		const activity = new ActivityTracker(editor)
		const client = new BridgeClient({
			url: BRIDGE_URL,
			handlers: flavour.createHandlers(editor, { activity }),
			onStatusChange: (next) => {
				setStatus(next)
				// The server re-sends the flag when it hears our hello; until then, nothing is known.
				if (next !== 'connected') setWorking(false)
				// Answers given while disconnected (or before a tab reload) reach the server now;
				// it ignores answers to questions it no longer waits for.
				if (next === 'connected') {
					for (const answered of answeredQuestionCards(editor)) {
						client.sendEvent('ask.answered', answered)
					}
				}
			},
			onAgentWorking: setWorking,
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
	}, [editor, flavour])

	return { status, working }
}
