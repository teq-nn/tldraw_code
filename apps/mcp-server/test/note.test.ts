import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { makeErrorResult, makeOkResult } from '@tldraw-code/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { createMcpServer, SERVER_INSTRUCTIONS } from '../src/server'
import { FakeCanvas } from './fakeCanvas'
import { waitFor } from './timing'

// render_note through the public seam: an MCP tool call in, a `note.render`
// command out; the fake canvas plays the real one.

let bridge: CanvasBridge
let port: number
let client: Client
const canvases: FakeCanvas[] = []

beforeEach(async () => {
	bridge = new CanvasBridge({ port: 0, requestTimeoutMs: 5000 })
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

async function connectCanvas(): Promise<FakeCanvas> {
	const canvas = await FakeCanvas.connect(port)
	canvases.push(canvas)
	canvas.respondWith((command) => {
		const { id, replyTo } = command.payload as { id?: string; replyTo?: string }
		return makeOkResult(command.id, {
			shapeId: `shape:agent-note:${id ?? 'x'}`,
			created: true,
			...(replyTo ? { replyToShapeId: replyTo } : {}),
		})
	})
	await waitFor(() => bridge.isConnected())
	return canvas
}

function call(args: Record<string, unknown>): Promise<CallToolResult> {
	return client.callTool({ name: 'render_note', arguments: args }) as Promise<CallToolResult>
}

function textOf(result: CallToolResult): string {
	return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
}

describe('render_note', () => {
	it('is listed as a tool that answers &agent notes', async () => {
		const { tools } = await client.listTools()
		const tool = tools.find((t) => t.name === 'render_note')
		expect(tool?.description).toContain('&agent')
	})

	it('sends the text, reply target and id to the canvas and reports the note', async () => {
		const canvas = await connectCanvas()
		const result = await call({ text: 'Queued is safer.', replyTo: 'shape:abc', id: 'flow-answer' })

		expect(result.isError).toBeFalsy()
		expect(canvas.commands[0]).toMatchObject({
			name: 'note.render',
			payload: { text: 'Queued is safer.', replyTo: 'shape:abc', id: 'flow-answer' },
		})
		expect(textOf(result)).toContain('Put note shape:agent-note:flow-answer next to shape:abc')
	})

	it('needs only the text', async () => {
		const canvas = await connectCanvas()
		const result = await call({ text: 'Hello.' })
		expect(result.isError).toBeFalsy()
		expect(canvas.commands[0]?.payload).toEqual({ text: 'Hello.' })
		expect(textOf(result)).toContain('to the right of the canvas content')
	})

	it('reports an update in place', async () => {
		const canvas = await connectCanvas()
		canvas.respondWith((command) =>
			makeOkResult(command.id, { shapeId: 'shape:agent-note:a', created: false }),
		)
		expect(textOf(await call({ text: 'Again.', id: 'a' }))).toContain('Updated note')
	})

	it('rejects text over 500 characters or empty text without touching the canvas', async () => {
		const canvas = await connectCanvas()
		for (const text of ['x'.repeat(501), '   ']) {
			const result = await call({ text })
			expect(result.isError).toBe(true)
			expect(textOf(result)).toMatch(/text/i)
		}
		expect(canvas.commands).toHaveLength(0)
	})

	it('turns an unknown replyTo into a clear tool error', async () => {
		const canvas = await connectCanvas()
		canvas.respondWith((command) =>
			makeErrorResult(command.id, {
				code: 'handler_failed',
				message:
					'There is no shape "shape:nope" on the canvas to reply to; use a shape id from read_canvas.',
			}),
		)
		const result = await call({ text: 'x', replyTo: 'shape:nope' })
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('There is no shape "shape:nope"')
	})

	it('reports a missing canvas as not_connected', async () => {
		const result = await call({ text: 'x' })
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('[not_connected]')
	})
})

describe('server instructions', () => {
	it('tell Claude to answer &agent notes with render_note, not only in the terminal', () => {
		expect(SERVER_INSTRUCTIONS).toContain('render_note')
	})
})
