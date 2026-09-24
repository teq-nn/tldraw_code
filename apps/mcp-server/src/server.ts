import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
	type CanvasCommandResult,
	computeFrontier,
	FrontierGraphSchema,
	FrontierGraphShape,
} from '@tldraw-code/protocol'
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

	server.registerTool(
		'render_graph',
		{
			title: 'Render frontier graph',
			description:
				'Draw or update the decision graph on the canvas. Pass the whole graph every time: ' +
				'decision nodes (stable id, short title, status open/resolved/blocked, optional one-line note) ' +
				'and dependency edges {from, to} meaning "from must be resolved before to". ' +
				'Layout, status colours and the frontier (open nodes whose blockers are all resolved, highlighted) ' +
				'are computed for you. Nodes and edges are matched by id: existing shapes are updated, ' +
				'new ones added, and ones missing from this call removed.',
			inputSchema: FrontierGraphShape,
		},
		async (args) =>
			toToolResult(async () => {
				const parsed = FrontierGraphSchema.safeParse(args)
				if (!parsed.success) {
					throw new InvalidInputError(
						'invalid_graph',
						parsed.error.issues
							.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
							.join('; '),
					)
				}
				const graph = parsed.data
				const frontier = computeFrontier(graph)
				const result = await bridge.request('graph.render', { ...graph, frontier })
				return describeRender(graph.nodes.length, graph.edges.length, frontier, result)
			}),
	)

	return server
}

function describeRender(
	nodeCount: number,
	edgeCount: number,
	frontier: string[],
	{ nodes, edges }: CanvasCommandResult<'graph.render'>,
): string {
	const counts = (c: typeof nodes) => `${c.created} new, ${c.updated} updated, ${c.removed} removed`
	return [
		`Rendered ${nodeCount} decision nodes (${counts(nodes)}) and ${edgeCount} edges (${counts(edges)}).`,
		`Frontier: ${frontier.length > 0 ? frontier.join(', ') : '(empty)'}.`,
	].join('\n')
}

/** Tool arguments passed the schema but are inconsistent (e.g. an edge to an unknown node). */
class InvalidInputError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message)
		this.name = 'InvalidInputError'
	}
}

async function toToolResult(run: () => Promise<string>): Promise<CallToolResult> {
	try {
		return { content: [{ type: 'text', text: await run() }] }
	} catch (error) {
		if (error instanceof CanvasBridgeError || error instanceof InvalidInputError) {
			return {
				isError: true,
				content: [{ type: 'text', text: `[${error.code}] ${error.message}` }],
			}
		}
		throw error
	}
}
