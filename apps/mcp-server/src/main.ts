import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { DEFAULT_BRIDGE_PORT } from '@tldraw-code/protocol'
import { CanvasBridge } from './bridge'
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

const server = createMcpServer(bridge)
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
