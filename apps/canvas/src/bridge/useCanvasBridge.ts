import { useEffect, useState } from 'react'
import type { Editor } from 'tldraw'
import type { BridgeStatus } from './BridgeClient'
import { connectBridge } from './connectBridge'

/** Overrides {@link DEFAULT_BRIDGE_URL} in dev/tests; unset in the built app. */
export const BRIDGE_URL: string | undefined = import.meta.env.VITE_CANVAS_BRIDGE_URL

export interface CanvasBridgeState {
	status: BridgeStatus
	/** Claude is working on a channel push (ADR 0025); the server owns this state. */
	working: boolean
}

/** Connect the given editor to the MCP server's bridge for as long as the component is mounted. */
export function useCanvasBridge(editor: Editor | undefined): CanvasBridgeState {
	const [status, setStatus] = useState<BridgeStatus>('disconnected')
	const [working, setWorking] = useState(false)

	useEffect(() => {
		if (!editor) return
		return connectBridge(editor, {
			url: BRIDGE_URL,
			onStatusChange: setStatus,
			onAgentWorking: setWorking,
		})
	}, [editor])

	return { status, working }
}
