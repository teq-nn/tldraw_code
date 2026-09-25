import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { AGENT_STOP_PATH, type CanvasActivity, makeOkResult } from '@tldraw-code/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { createMcpServer } from '../src/server'
import { FakeCanvas } from './fakeCanvas'
import { ManualClock, waitFor } from './timing'

// The "Claude is working" signal (ADR 0025) through the public seam: `canvas.activity`
// events in, `agent.working` events out to a fake canvas tab, tool calls from an MCP client,
// and the Claude Code `Stop` hook as an HTTP POST to the bridge.

const WORKING_TIMEOUT_MS = 120_000

let bridge: CanvasBridge
let client: Client
let canvas: FakeCanvas
let clock: ManualClock
let pushes: number
let port: number

/** A sticky note addressed to Claude with the `&agent` tag. */
const note: CanvasActivity = { added: { sticky_note: 1 }, changed: 0, removed: 0, invoked: 1 }

beforeEach(async () => {
	bridge = new CanvasBridge({ port: 0, requestTimeoutMs: 200 })
	port = await bridge.start()
	clock = new ManualClock()
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await createMcpServer(bridge, { clock, workingTimeoutMs: WORKING_TIMEOUT_MS }).connect(
		serverTransport,
	)
	client = new Client({ name: 'test', version: '0.0.0' })
	pushes = 0
	client.fallbackNotificationHandler = async (notification) => {
		if (notification.method === 'notifications/claude/channel') pushes++
	}
	await client.connect(clientTransport)
	canvas = await FakeCanvas.connect(port)
	await waitFor(() => bridge.isConnected(), 'the canvas to connect')
})

afterEach(async () => {
	await client.close()
	await canvas.close()
	await bridge.stop()
})

/** The `working` flags the canvas was sent, in order. */
const workingEvents = () =>
	canvas.events
		.filter((event) => event.name === 'agent.working')
		.map((event) => (event.payload as { working: boolean }).working)

/** Send a tagged note and wait until the server pushed it and told the canvas. */
async function invoke() {
	const before = pushes
	canvas.sendEvent('canvas.activity', note)
	await waitFor(() => pushes > before, 'the channel push')
	await waitFor(() => workingEvents().length > 0, 'the working event')
}

async function readCanvas() {
	canvas.respondWith((command) =>
		makeOkResult(command.id, { region: null, shapes: [], omitted: 0, screenshot: null }),
	)
	await client.callTool({ name: 'read_canvas', arguments: { screenshot: false } })
}

/** What the Claude Code `Stop` hook does when a turn ends (`.claude/settings.json`). */
const stopHook = (headers: Record<string, string> = {}) =>
	fetch(`http://127.0.0.1:${port}${AGENT_STOP_PATH}`, { method: 'POST', headers })

/** Let the flag and the socket settle after something that must NOT change it. */
async function settle() {
	for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 10))
}

describe('agent working signal', () => {
	it('tells the canvas Claude is working once a push went out', async () => {
		await invoke()
		expect(workingEvents()).toEqual([true])
	})

	it('stays quiet without a push', async () => {
		canvas.sendEvent('canvas.activity', { added: { sticky_note: 1 }, changed: 0, removed: 0 })
		canvas.sendEvent('canvas.activity', { added: {}, changed: 2, removed: 0 })
		await readCanvas()
		await stopHook()
		clock.advance(WORKING_TIMEOUT_MS)
		await settle()
		expect(workingEvents()).toEqual([])
	})

	it('stops when the Claude Code turn ends (Stop hook)', async () => {
		await invoke()
		const response = await stopHook()
		expect(response.status).toBe(204)
		await waitFor(() => workingEvents().length === 2, 'the idle event')
		expect(workingEvents()).toEqual([true, false])
	})

	it('keeps going through canvas tool calls, which are not the final answer', async () => {
		await invoke()
		await readCanvas()
		canvas.respondWith((command) => makeOkResult(command.id, { shapeId: 'shape:fake' }))
		await client.callTool({ name: 'canvas_smoke_test', arguments: {} })
		canvas.failWith('handler_failed', 'boom')
		await client.callTool({ name: 'canvas_smoke_test', arguments: {} })
		await settle()
		expect(workingEvents()).toEqual([true])
		await stopHook()
		await waitFor(() => workingEvents().length === 2, 'the idle event')
		expect(workingEvents()).toEqual([true, false])
	})

	it('stops after the timeout when no Stop hook and no canvas call arrives', async () => {
		await invoke()
		clock.advance(WORKING_TIMEOUT_MS - 1)
		expect(workingEvents()).toEqual([true])
		clock.advance(1)
		await waitFor(() => workingEvents().length === 2, 'the idle event')
		expect(workingEvents()).toEqual([true, false])
	})

	it('counts a canvas tool call as a sign of life that restarts the timeout', async () => {
		await invoke()
		clock.advance(WORKING_TIMEOUT_MS - 1)
		await readCanvas()
		clock.advance(WORKING_TIMEOUT_MS - 1)
		expect(workingEvents()).toEqual([true])
		clock.advance(1)
		await waitFor(() => workingEvents().length === 2, 'the idle event')
	})

	it('does not fire the timeout after the turn already ended', async () => {
		await invoke()
		await stopHook()
		await waitFor(() => workingEvents().length === 2, 'the idle event')
		clock.advance(WORKING_TIMEOUT_MS)
		await settle()
		expect(workingEvents()).toEqual([true, false])
	})

	it('ignores stop requests from web pages and unknown requests', async () => {
		await invoke()
		expect((await stopHook({ Origin: 'https://evil.example' })).status).toBe(403)
		expect((await fetch(`http://127.0.0.1:${port}${AGENT_STOP_PATH}`)).status).toBe(404)
		expect((await fetch(`http://127.0.0.1:${port}/other`, { method: 'POST' })).status).toBe(404)
		await settle()
		expect(workingEvents()).toEqual([true])
	})

	it('restarts the timeout on a second push', async () => {
		await invoke()
		clock.advance(WORKING_TIMEOUT_MS - 1_000)
		canvas.sendEvent('canvas.activity', { ...note, added: { sticky_note: 2 } })
		await waitFor(() => pushes === 2, 'the second push')
		clock.advance(WORKING_TIMEOUT_MS - 1)
		expect(workingEvents().at(-1)).toBe(true)
		clock.advance(1)
		await waitFor(() => workingEvents().at(-1) === false, 'the idle event')
	})

	it('tells a canvas that reconnects while Claude is working', async () => {
		await invoke()
		const reloaded = await FakeCanvas.connect(port)
		await waitFor(() => reloaded.events.length > 0, 'the working event on the new tab')
		expect(reloaded.events.map((event) => event.payload)).toEqual([{ working: true }])
		await reloaded.close()
	})
})
