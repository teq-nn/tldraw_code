import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
	type CanvasCommandPayload,
	type CanvasShape,
	makeErrorResult,
	makeOkResult,
} from '@tldraw-code/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { createMcpServer } from '../src/server'
import { FakeCanvas } from './fakeCanvas'

// render_prototype through the public seam: MCP tool calls in, `prototype.render`
// commands out; and how read_canvas reports annotations on a prototype.

let bridge: CanvasBridge
let port: number
let client: Client
const canvases: FakeCanvas[] = []

const html = '<!doctype html><button id="go">Sign in</button>'

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

/** A fake canvas that answers `prototype.render` like the real one. */
async function connectCanvas(): Promise<FakeCanvas> {
	const canvas = await FakeCanvas.connect(port)
	canvases.push(canvas)
	canvas.respondWith((command) => {
		const payload = command.payload as CanvasCommandPayload<'prototype.render'>
		return makeOkResult(command.id, {
			shapeId: `shape:prototype:${payload.id}`,
			created: true,
			bounds: { x: 600, y: 0, w: payload.width ?? 480, h: (payload.height ?? 360) + 56 },
			width: payload.width ?? 480,
			height: payload.height ?? 360,
			...(payload.iterationOf
				? { iterationOfShapeId: `shape:prototype:${payload.iterationOf}` }
				: {}),
		})
	})
	for (let i = 0; i < 100 && !bridge.isConnected(); i++) await new Promise((r) => setTimeout(r, 10))
	return canvas
}

function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
	return client.callTool({ name, arguments: args }) as Promise<CallToolResult>
}

function textOf(result: CallToolResult): string {
	return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
}

describe('render_prototype', () => {
	it('is listed as a tool taking html and a label', async () => {
		const { tools } = await client.listTools()
		const tool = tools.find((t) => t.name === 'render_prototype')
		expect(tool?.inputSchema.required).toEqual(expect.arrayContaining(['html', 'label']))
		expect(tool?.description).toMatch(/sandboxed/)
	})

	it('sends the HTML with an id derived from the label, and reports where it is', async () => {
		const canvas = await connectCanvas()
		const result = await call('render_prototype', { html, label: 'Login form' })

		expect(result.isError).toBeFalsy()
		expect(canvas.commands[0]).toMatchObject({
			name: 'prototype.render',
			payload: { id: 'login-form', label: 'Login form', html },
		})
		expect(canvas.commands[0]?.payload).not.toHaveProperty('iterationOf')
		expect(textOf(result)).toContain(
			'Rendered prototype "login-form" ("Login form") in shape shape:prototype:login-form at x 600, y 0',
		)
		expect(textOf(result)).toContain('viewport 480 x 360 px')
	})

	it('passes a new iteration with its caption and size, and says where it went', async () => {
		const canvas = await connectCanvas()
		const result = await call('render_prototype', {
			html,
			label: 'Login v2',
			caption: 'Bigger button, as sketched.',
			iterationOf: 'login-form',
			width: 640,
			height: 420,
		})

		expect(canvas.commands[0]?.payload).toMatchObject({
			id: 'login-v2',
			iterationOf: 'login-form',
			caption: 'Bigger button, as sketched.',
			width: 640,
			height: 420,
		})
		expect(textOf(result)).toContain('new iteration of "login-form", placed right next to it')
	})

	it('rejects invalid input without touching the canvas', async () => {
		const canvas = await connectCanvas()
		const result = await call('render_prototype', { html, label: 'Login', iterationOf: 'login' })

		expect(result.isError).toBe(true)
		expect(textOf(result)).toMatch(/^\[invalid_prototype\] iterationOf: /)
		expect(canvas.commands).toHaveLength(0)
	})

	it("reports the canvas's refusal, e.g. an unknown prototype to iterate on", async () => {
		const canvas = await connectCanvas()
		canvas.respondWith((command) =>
			makeErrorResult(command.id, {
				code: 'handler_failed',
				message: 'There is no prototype "signup" on the canvas to iterate on.',
			}),
		)
		const result = await call('render_prototype', {
			html,
			label: 'Signup v2',
			iterationOf: 'signup',
		})
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('no prototype "signup"')
	})

	it('fails with not_connected when no canvas is open', async () => {
		const result = await call('render_prototype', { html, label: 'Login' })
		expect(textOf(result)).toMatch(/^\[not_connected\]/)
	})
})

describe('read_canvas of prototypes', () => {
	it('names the prototype and where an annotation lies inside it', async () => {
		const prototype: CanvasShape = {
			id: 'shape:prototype:login-v2',
			type: 'prototype-frame',
			role: 'prototype_frame',
			owner: 'claude',
			bounds: { x: 600, y: 0, w: 480, h: 416 },
			text: 'Login v2\nBigger button.',
			prototype: {
				id: 'login-v2',
				label: 'Login v2',
				iterationOf: 'login',
				width: 480,
				height: 360,
			},
		}
		const note: CanvasShape = {
			id: 'shape:n1',
			type: 'note',
			role: 'sticky_note',
			owner: 'user',
			bounds: { x: 640, y: 156, w: 200, h: 200 },
			text: 'Move this up',
			anchor: {
				shapeId: prototype.id,
				role: 'prototype_frame',
				relation: 'on',
				label: 'Login v2',
				inPrototype: { x: 40, y: 100, w: 200, h: 200 },
			},
		}
		const canvas = await connectCanvas()
		canvas.respondWith((command) =>
			makeOkResult(command.id, {
				region: { x: 568, y: -32, w: 544, h: 480 },
				shapes: [note, prototype],
				omitted: 0,
				screenshot: null,
			}),
		)
		const text = textOf(await call('read_canvas', { screenshot: false }))
		expect(text).toContain(
			'sticky note "Move this up" on prototype "Login v2" (shape:prototype:login-v2) over its x 40, y 100, 200 x 200 (prototype px)',
		)
		expect(text).toContain(
			'prototype "login-v2" (iteration of "login") viewport 480 x 360 px "Login v2\\nBigger button."',
		)
	})
})
