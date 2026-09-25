import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DEFAULT_BRIDGE_PORT } from '@tldraw-code/protocol'
import { CanvasBridge } from './bridge'
import { startDesktopBackend } from './desktop'
import { createMcpServer } from './server'

// stdout is reserved for the MCP stdio transport; all diagnostics go to stderr.
const log = (message: string) => process.stderr.write(`[tldraw-canvas] ${message}\n`)

const port = Number(process.env.CANVAS_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT)
const bridge = new CanvasBridge({ port, log })

try {
	await bridge.start()
} catch (error) {
	// Keep serving MCP so tools report a clear error instead of the server vanishing.
	log(
		`could not start the canvas bridge on port ${port}: ${(error as Error).message}. ` +
			'Is another Claude Code session already running this server? Set CANVAS_BRIDGE_PORT to use another port.',
	)
}

// CANVAS_BACKEND=desktop (ticket #16): the canvas runs as a tldraw offline
// board script instead of the Vite app. The bridge above is unchanged
// either way — it is the board script that connects to it, exactly like the
// Vite canvas does over ws://127.0.0.1:<CANVAS_BRIDGE_PORT>.
if (process.env.CANVAS_BACKEND === 'desktop') {
	try {
		const installed = await startDesktopBackend({ log })
		log(
			`tldraw offline: installed the board script into "${installed.docName}" ` +
				`(${installed.filePath ?? installed.docId}); it will connect to this bridge on its own`,
		)
	} catch (error) {
		// Keep serving MCP: tools still work once the user installs or reconnects the canvas by hand.
		log(
			`could not install the canvas as a tldraw offline board script: ${(error as Error).message}`,
		)
	}
}

const askTimeoutMs = Number(process.env.CANVAS_ASK_TIMEOUT_MS)
const server = createMcpServer(bridge, {
	log,
	ask: Number.isFinite(askTimeoutMs) && askTimeoutMs > 0 ? { timeoutMs: askTimeoutMs } : {},
})
await server.connect(new StdioServerTransport())
log('MCP server ready on stdio')

const shutdown = async () => {
	await server.close()
	await bridge.stop()
	process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.stdin.on('close', shutdown)
