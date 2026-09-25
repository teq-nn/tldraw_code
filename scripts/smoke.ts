/**
 * End-to-end smoke test of the bridge without Claude Code: spawns the MCP
 * server over stdio (exactly as Claude Code would), waits for the canvas to
 * connect, then calls `canvas_smoke_test`. Have tldraw offline running first
 * (default backend; `pnpm build:board-script` once if you have not), or, on
 * the `CANVAS_BACKEND=vite` fallback, run `pnpm dev` and open the canvas.
 *
 *   pnpm smoke ["optional label"]
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

const WAIT_FOR_CANVAS_MS = 30_000
const label = process.argv[2] ?? 'Hello from the smoke test'

const transport = new StdioClientTransport({
	command: process.execPath,
	args: ['--import', 'tsx', 'apps/mcp-server/src/main.ts'],
	stderr: 'inherit',
})
const client = new Client({ name: 'smoke', version: '0.0.0' })
await client.connect(transport)

const deadline = Date.now() + WAIT_FOR_CANVAS_MS
let result: CallToolResult
for (;;) {
	result = (await client.callTool({
		name: 'canvas_smoke_test',
		arguments: { text: label },
	})) as CallToolResult
	const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
	const waiting = result.isError && text.includes('not_connected')
	if (!waiting || Date.now() > deadline) {
		console.log(text)
		break
	}
	await new Promise((resolve) => setTimeout(resolve, 500))
}

await client.close()
process.exit(result.isError ? 1 : 0)
