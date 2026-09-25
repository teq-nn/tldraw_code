import type { Editor } from 'tldraw'
import type { BridgeStatus } from '../bridge/BridgeClient'
import { connectBridge } from '../bridge/connectBridge'
import { publishBridgeState } from './bridgeStatusChannel'
import { injectBoardStyles } from './injectBoardStyles'

/**
 * `index.css` (bridge pill, question card, prototype frame styles), inlined
 * at build time by `scripts/build-board-script.mjs` — see that file for why
 * this is a build-time constant and not a runtime import.
 */
declare const __BOARD_CSS__: string

/**
 * Overrides {@link connectBridge}'s default bridge URL; '' (the default
 * build) keeps `connectBridge`'s own `DEFAULT_BRIDGE_URL`. Set at build time
 * with `CANVAS_BOARD_SCRIPT_BRIDGE_URL`, the board-script equivalent of the
 * Vite canvas's `VITE_CANVAS_BRIDGE_URL` (both are build-time: neither app
 * can read `CANVAS_BRIDGE_PORT` from the MCP server's own process at runtime).
 */
declare const __BOARD_BRIDGE_URL__: string

interface BoardScriptContext {
	editor: Editor
	signal: AbortSignal
}

/**
 * `main.js`'s default export: connects the mounted editor to the MCP
 * server's bridge exactly like the Vite canvas does — {@link connectBridge}
 * is the same function `useCanvasBridge` calls — and publishes the status to
 * `config.js`'s TopPanel (ticket #16). Runs once after the editor mounts;
 * `signal` fires when the script reruns (e.g. `main.js` was edited again) or
 * the document closes.
 */
export default function main({ editor, signal }: BoardScriptContext): void {
	injectBoardStyles(__BOARD_CSS__)

	let status: BridgeStatus = 'disconnected'
	let working = false
	const publish = () => publishBridgeState({ status, working })
	publish()

	const stop = connectBridge(editor, {
		url: __BOARD_BRIDGE_URL__ || undefined,
		onStatusChange: (next) => {
			status = next
			publish()
		},
		onAgentWorking: (next) => {
			working = next
			publish()
		},
	})

	signal.addEventListener('abort', () => {
		stop()
		status = 'disconnected'
		working = false
		publish()
	})
}
