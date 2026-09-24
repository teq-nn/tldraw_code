import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { type CanvasBridge, CanvasBridgeError } from './bridge'

export const SERVER_NAME = 'tldraw-canvas'
export const SERVER_VERSION = '0.0.0'

/**
 * Build the MCP server with all canvas tools registered. Transport-agnostic:
 * `main.ts` connects it to stdio, tests connect it to an in-memory transport.
 */
export function createMcpServer(bridge: CanvasBridge): McpServer {
	const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })

	server.registerTool(
		'canvas_smoke_test',
		{
			title: 'Canvas smoke test',
			description:
				'Create one labelled rectangle in the middle of the open tldraw canvas to verify that the MCP server can reach the canvas.',
			inputSchema: {
				text: z
					.string()
					.min(1)
					.max(200)
					.optional()
					.describe('Label for the shape. Defaults to "Hello from Claude Code".'),
			},
		},
		async ({ text }) =>
			toToolResult(async () => {
				const { shapeId } = await bridge.request('smoke.create_shape', {
					text: text ?? 'Hello from Claude Code',
				})
				return `Created shape ${shapeId} on the canvas.`
			}),
	)

	return server
}

async function toToolResult(run: () => Promise<string>): Promise<CallToolResult> {
	try {
		return { content: [{ type: 'text', text: await run() }] }
	} catch (error) {
		if (error instanceof CanvasBridgeError) {
			return {
				isError: true,
				content: [{ type: 'text', text: `[${error.code}] ${error.message}` }],
			}
		}
		throw error
	}
}
