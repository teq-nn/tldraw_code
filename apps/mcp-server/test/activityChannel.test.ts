import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult, Notification } from '@modelcontextprotocol/sdk/types.js'
import { type CanvasActivity, makeOkResult } from '@tldraw-code/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { createMcpServer } from '../src/server'
import { FakeCanvas } from './fakeCanvas'

// Pushing canvas activity into the session (ADR 0024) through the public seam:
// `canvas.activity` events in from a fake canvas tab, channel notifications
// out to an MCP client.

let bridge: CanvasBridge
let client: Client
let canvas: FakeCanvas
let pushed: Notification[]

/** A sticky note addressed to Claude with the `&agent` tag (ADR 0024). */
const note: CanvasActivity = { added: { sticky_note: 1 }, changed: 0, removed: 0, invoked: 1 }

beforeEach(async () => {
	bridge = new CanvasBridge({ port: 0, requestTimeoutMs: 200 })
	const port = await bridge.start()
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await createMcpServer(bridge).connect(serverTransport)
	client = new Client({ name: 'test', version: '0.0.0' })
	pushed = []
	client.fallbackNotificationHandler = async (notification) => {
		if (notification.method === 'notifications/claude/channel') pushed.push(notification)
	}
	await client.connect(clientTransport)
	canvas = await FakeCanvas.connect(port)
	for (let i = 0; i < 100 && !bridge.isConnected(); i++) await tick()
})

afterEach(async () => {
	await client.close()
	await canvas.close()
	await bridge.stop()
})

const tick = () => new Promise((r) => setTimeout(r, 10))

/** Let an event cross the socket and the in-memory transport. */
async function settle() {
	for (let i = 0; i < 5; i++) await tick()
}

async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
	return (await client.callTool({ name, arguments: args })) as CallToolResult
}

describe('canvas activity channel', () => {
	it('declares itself a Claude Code channel', () => {
		expect(client.getServerCapabilities()?.experimental).toEqual({ 'claude/channel': {} })
		expect(client.getInstructions()).toContain('<channel source="tldraw-canvas">')
	})

	it('pushes a sticky note the user tagged &agent', async () => {
		canvas.sendEvent('canvas.activity', note)
		await settle()
		expect(pushed).toHaveLength(1)
		expect(pushed[0]?.params).toEqual({
			content:
				'Canvas activity since your last read_canvas: the user added 1 sticky note; addressed you with &agent in 1 sticky note. Call read_canvas to see it.',
			meta: { event: 'canvas_activity' },
		})
	})

	it('does not wake Claude for activity that is not addressed to it', async () => {
		canvas.sendEvent('canvas.activity', { added: { sticky_note: 1 }, changed: 0, removed: 0 })
		canvas.sendEvent('canvas.activity', { added: {}, changed: 3, removed: 0 })
		canvas.sendEvent('canvas.activity', { added: {}, changed: 0, removed: 2 })
		await settle()
		expect(pushed).toEqual([])
	})

	it('pushes the same digest only once until Claude reads the canvas', async () => {
		canvas.sendEvent('canvas.activity', note)
		canvas.sendEvent('canvas.activity', note)
		await settle()
		expect(pushed).toHaveLength(1)

		const twoNotes: CanvasActivity = { ...note, added: { sticky_note: 2 } }
		canvas.sendEvent('canvas.activity', twoNotes)
		await settle()
		expect(pushed).toHaveLength(2)

		canvas.respondWith((command) =>
			makeOkResult(command.id, { region: null, shapes: [], omitted: 0, screenshot: null }),
		)
		const read = await callTool('read_canvas', { screenshot: false })
		expect(read.isError).toBeFalsy()
		canvas.sendEvent('canvas.activity', twoNotes)
		await settle()
		expect(pushed).toHaveLength(3)
	})

	it('leaves activity during a tool call to its result', async () => {
		canvas.activity = note
		canvas.respondWith((command) => {
			canvas.sendEvent('canvas.activity', note)
			return makeOkResult(command.id, { shapeId: 'shape:fake' })
		})
		const result = await callTool('canvas_smoke_test', {})
		expect(result.content[0]).toMatchObject({
			text: expect.stringContaining('added 1 sticky note'),
		})

		// The same activity reported again after the call is not news either.
		canvas.sendEvent('canvas.activity', note)
		await settle()
		expect(pushed).toEqual([])
	})

	it('ignores malformed events', async () => {
		canvas.sendEvent('canvas.activity', { added: { unicorn: 1 } })
		await settle()
		expect(pushed).toEqual([])
	})
})
