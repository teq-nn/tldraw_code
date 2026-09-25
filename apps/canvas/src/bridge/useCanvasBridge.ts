import { DEFAULT_BRIDGE_PORT } from '@tldraw-code/protocol'
import { useEffect, useState } from 'react'
import type { Editor } from 'tldraw'
import { answeredQuestionCards, watchQuestionCards } from '../ask/watchQuestionCards'
import { ActivityTracker } from '../perception/activity'
import { pushActivityWhenQuiet } from '../perception/activityPush'
import { BridgeClient, type BridgeStatus } from './BridgeClient'
import { createCommandHandlers } from './commandHandlers'

export const BRIDGE_URL: string =
	import.meta.env.VITE_CANVAS_BRIDGE_URL ?? `ws://127.0.0.1:${DEFAULT_BRIDGE_PORT}`

/** Connect the given editor to the MCP server's bridge for as long as the component is mounted. */
export function useCanvasBridge(editor: Editor | undefined): BridgeStatus {
	const [status, setStatus] = useState<BridgeStatus>('disconnected')

	useEffect(() => {
		if (!editor) return
		const activity = new ActivityTracker(editor)
		const client = new BridgeClient({
			url: BRIDGE_URL,
			handlers: createCommandHandlers(editor, { activity }),
			onStatusChange: (next) => {
				setStatus(next)
				// Answers given while disconnected (or before a tab reload) reach the server now;
				// it ignores answers to questions it no longer waits for.
				if (next === 'connected') {
					for (const answered of answeredQuestionCards(editor)) {
						client.sendEvent('ask.answered', answered)
					}
				}
			},
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
	}, [editor])

	return status
}
