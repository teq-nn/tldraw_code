import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DEFAULT_BRIDGE_PORT } from '@tldraw-code/protocol'
import { resolveCanvasBackend } from './backend'
import { CanvasBridge } from './bridge'
import { createDesktopReadiness, DesktopCanvasBridge } from './desktop'
import { createMcpServer } from './server'

// stdout is reserved for the MCP stdio transport; all diagnostics go to stderr.
const log = (message: string) => process.stderr.write(`[tldraw-canvas] ${message}\n`)

const port = Number(process.env.CANVAS_BRIDGE_PORT ?? DEFAULT_BRIDGE_PORT)
// tldraw offline is the default backend (ticket #19); CANVAS_BACKEND=vite is
// the explicit fallback to the Vite app, kept until it is retired. Either
// way the canvas runs as a tldraw offline board script instead of the Vite
// app when `desktopBackend` is true. The protocol and the WebSocket server
// below are unchanged either way — DesktopCanvasBridge only wraps `request`
// to keep the installed script current and the file saved (ticket #17); it
// is the board script that connects, exactly like the Vite canvas does over
// ws://127.0.0.1:<CANVAS_BRIDGE_PORT>.
const desktopBackend = resolveCanvasBackend(process.env.CANVAS_BACKEND) === 'desktop'
const desktopReadiness = desktopBackend ? createDesktopReadiness({ log }) : undefined
const bridge = desktopReadiness
	? new DesktopCanvasBridge({ port, log, readiness: desktopReadiness })
	: new CanvasBridge({ port, log })

try {
	await bridge.start()
} catch (error) {
	// Keep serving MCP so tools report a clear error instead of the server vanishing.
	log(
		`could not start the canvas bridge on port ${port}: ${(error as Error).message}. ` +
			'Is another Claude Code session already running this server? Set CANVAS_BRIDGE_PORT to use another port.',
	)
}

if (desktopReadiness) {
	try {
		// Same install `DesktopCanvasBridge` runs lazily before every command (ticket #17):
		// doing it eagerly here just means the very first tool call doesn't pay for it, and a
		// stale bundle from a previous session is caught before Claude asks for anything.
		const installed = await desktopReadiness.ensureInstalled()
		log(
			`tldraw offline: installed the board script into "${installed.docName}" ` +
				`(${installed.filePath ?? installed.docId}); it will connect to this bridge on its own`,
		)
	} catch (error) {
		// Keep serving MCP: the first tool call retries the install and reports a clear
		// error itself (ticket #17) if tldraw offline still isn't reachable by then.
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
