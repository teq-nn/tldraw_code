import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { makeOkResult } from '@tldraw-code/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { createMcpServer } from '../src/server'
import { FakeCanvas } from './fakeCanvas'

// Tests drive the public seam: MCP tool calls in, canvas commands out, against a fake canvas tab.

let bridge: CanvasBridge
let port: number
let client: Client
const canvases: FakeCanvas[] = []

async function connectCanvas(origin?: string): Promise<FakeCanvas> {
	const canvas = await FakeCanvas.connect(port, origin)
	canvases.push(canvas)
	await waitFor(() => bridge.isConnected())
	return canvas
}

async function waitFor(condition: () => boolean): Promise<void> {
	for (let i = 0; i < 100 && !condition(); i++) await new Promise((r) => setTimeout(r, 10))
	if (!condition()) throw new Error('condition not met')
}

async function smokeTest(args: Record<string, unknown> = {}): Promise<CallToolResult> {
	return (await client.callTool({ name: 'canvas_smoke_test', arguments: args })) as CallToolResult
}

function textOf(result: CallToolResult): string {
	return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
}

beforeEach(async () => {
	bridge = new CanvasBridge({ port: 0, requestTimeoutMs: 200 })
	port = await bridge.start()
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await createMcpServer(bridge).connect(serverTransport)
	client = new Client({ name: 'test', version: '0.0.0' })
	await client.connect(clientTransport)
})

afterEach(async () => {
	await client.close()
	await Promise.all(canvases.splice(0).map((c) => c.close()))
	await bridge.stop()
})

describe('canvas_smoke_test', () => {
	it('is listed as a tool', async () => {
		const { tools } = await client.listTools()
		expect(tools.map((t) => t.name)).toContain('canvas_smoke_test')
	})

	it('sends a create-shape command to the canvas and reports the new shape', async () => {
		const canvas = await connectCanvas()
		canvas.respondWith((command) => makeOkResult(command.id, { shapeId: 'shape:abc' }))

		const result = await smokeTest({ text: 'Bridge works' })

		expect(canvas.commands).toHaveLength(1)
		expect(canvas.commands[0]).toMatchObject({
			v: 1,
			kind: 'command',
			name: 'smoke.create_shape',
			payload: { text: 'Bridge works' },
		})
		expect(result.isError).toBeFalsy()
		expect(textOf(result)).toContain('shape:abc')
	})

	it('uses a default label when none is given', async () => {
		const canvas = await connectCanvas()
		await smokeTest()
		expect(canvas.commands[0]?.payload).toEqual({ text: 'Hello from Claude Code' })
	})

	it('reports a tool error when no canvas is connected', async () => {
		const result = await smokeTest()
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('not_connected')
	})

	it('reports a tool error when the canvas does not answer in time', async () => {
		const canvas = await connectCanvas()
		canvas.respondWith(() => undefined)
		const result = await smokeTest()
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('timeout')
	})

	it('passes canvas-side failures through as tool errors', async () => {
		const canvas = await connectCanvas()
		canvas.failWith('handler_failed', 'editor exploded')
		const result = await smokeTest()
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('editor exploded')
	})

	it('rejects a malformed result from the canvas', async () => {
		const canvas = await connectCanvas()
		canvas.respondWith((command) => makeOkResult(command.id, { nope: true }))
		const result = await smokeTest()
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('invalid_payload')
	})

	it('sends commands to the most recently connected canvas tab', async () => {
		const first = await connectCanvas()
		const firstClosed = first.closed()
		const second = await connectCanvas()
		expect(await firstClosed).toBe(4000)

		await smokeTest()

		expect(first.commands).toHaveLength(0)
		expect(second.commands).toHaveLength(1)
	})
})

describe('bridge origin check', () => {
	it('accepts a canvas served from localhost', async () => {
		await expect(connectCanvas('http://localhost:5173')).resolves.toBeDefined()
	})

	it('refuses browser connections from other sites', async () => {
		await expect(FakeCanvas.connect(port, 'https://evil.example')).rejects.toThrow('401')
	})
})

describe('bridge port conflict', () => {
	it('explains in the tool error that the bridge port is taken', async () => {
		const second = new CanvasBridge({ port })
		await expect(second.start()).rejects.toThrow()
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
		await createMcpServer(second).connect(serverTransport)
		const otherClient = new Client({ name: 'test', version: '0.0.0' })
		await otherClient.connect(clientTransport)

		const result = (await otherClient.callTool({
			name: 'canvas_smoke_test',
			arguments: {},
		})) as CallToolResult

		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('CANVAS_BRIDGE_PORT')
		await otherClient.close()
		await second.stop()
	})
})

describe('render_graph', () => {
	const graph = {
		nodes: [
			{ id: 'a', title: 'Storage', status: 'resolved', note: 'SQLite' },
			{ id: 'b', title: 'Schema', status: 'open' },
			{ id: 'c', title: 'Hosting', status: 'blocked' },
			{ id: 'd', title: 'Migrations', status: 'open' },
		],
		edges: [
			{ from: 'a', to: 'b' },
			{ from: 'b', to: 'd' },
		],
	}
	const counts = { created: 0, updated: 0, removed: 0 }

	async function renderGraph(args: Record<string, unknown>): Promise<CallToolResult> {
		return (await client.callTool({ name: 'render_graph', arguments: args })) as CallToolResult
	}

	function answerRender(canvas: FakeCanvas) {
		canvas.respondWith((command) =>
			makeOkResult(command.id, {
				nodes: { ...counts, created: 4 },
				edges: { ...counts, created: 2 },
			}),
		)
	}

	it('is listed as a tool', async () => {
		const { tools } = await client.listTools()
		expect(tools.map((t) => t.name)).toContain('render_graph')
	})

	it('sends the graph with its computed frontier to the canvas', async () => {
		const canvas = await connectCanvas()
		answerRender(canvas)

		const result = await renderGraph(graph)

		expect(result.isError).toBeFalsy()
		expect(canvas.commands).toHaveLength(1)
		expect(canvas.commands[0]).toMatchObject({
			name: 'graph.render',
			payload: { nodes: graph.nodes, edges: graph.edges, frontier: ['b'] },
		})
		expect(textOf(result)).toContain('4 new')
		expect(textOf(result)).toContain('Frontier: b.')
	})

	it('treats a missing edge list as no edges', async () => {
		const canvas = await connectCanvas()
		answerRender(canvas)
		await renderGraph({ nodes: graph.nodes })
		expect(canvas.commands[0]?.payload).toMatchObject({ edges: [], frontier: ['b', 'd'] })
	})

	it.each([
		['an edge to an unknown node', { ...graph, edges: [{ from: 'a', to: 'zzz' }] }, 'zzz'],
		['duplicate node ids', { ...graph, nodes: [...graph.nodes, graph.nodes[0]] }, 'duplicate'],
		['a self-dependency', { ...graph, edges: [{ from: 'b', to: 'b' }] }, 'itself'],
		['a duplicate edge', { ...graph, edges: [graph.edges[0], graph.edges[0]] }, 'duplicate edge'],
	])('rejects %s without touching the canvas', async (_name, args, message) => {
		const canvas = await connectCanvas()
		const result = await renderGraph(args)
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('invalid_graph')
		expect(textOf(result)).toContain(message)
		expect(canvas.commands).toHaveLength(0)
	})

	it('rejects an unknown status', async () => {
		const canvas = await connectCanvas()
		const result = await renderGraph({ nodes: [{ id: 'a', title: 'A', status: 'done' }] })
		expect(result.isError).toBe(true)
		expect(canvas.commands).toHaveLength(0)
	})

	it('reports a tool error when no canvas is connected', async () => {
		const result = await renderGraph(graph)
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('not_connected')
	})
})
