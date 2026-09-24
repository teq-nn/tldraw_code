import { DEFAULT_BRIDGE_PORT } from '@tldraw-code/protocol'
import { useEffect, useState } from 'react'
import type { Editor } from 'tldraw'
import { BridgeClient, type BridgeStatus } from './BridgeClient'
import { createCommandHandlers } from './commandHandlers'

export const BRIDGE_URL: string =
	import.meta.env.VITE_CANVAS_BRIDGE_URL ?? `ws://127.0.0.1:${DEFAULT_BRIDGE_PORT}`

/** Connect the given editor to the MCP server's bridge for as long as the component is mounted. */
export function useCanvasBridge(editor: Editor | undefined): BridgeStatus {
	const [status, setStatus] = useState<BridgeStatus>('disconnected')

	useEffect(() => {
		if (!editor) return
		const client = new BridgeClient({
			url: BRIDGE_URL,
			handlers: createCommandHandlers(editor),
			onStatusChange: setStatus,
		})
		client.start()
		return () => client.stop()
	}, [editor])

	return status
}
