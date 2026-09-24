import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { type CanvasCommandResult, type CanvasShape, makeOkResult } from '@tldraw-code/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { describeActivity } from '../src/perception'
import { createMcpServer } from '../src/server'
import { FakeCanvas } from './fakeCanvas'

// read_canvas and the activity digest through the public seam: MCP tool calls
// in, `canvas.read` / `canvas.activity` commands out, against a fake canvas tab.

let bridge: CanvasBridge
let port: number
let client: Client
const canvases: FakeCanvas[] = []

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

async function connectCanvas(): Promise<FakeCanvas> {
	const canvas = await FakeCanvas.connect(port)
	canvases.push(canvas)
	for (let i = 0; i < 100 && !bridge.isConnected(); i++) await new Promise((r) => setTimeout(r, 10))
	return canvas
}

async function readCanvas(args: Record<string, unknown> = {}): Promise<CallToolResult> {
	return (await client.callTool({ name: 'read_canvas', arguments: args })) as CallToolResult
}

function textOf(result: CallToolResult): string {
	return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
}

const card: CanvasShape = {
	id: 'shape:question-card:q1',
	type: 'question-card',
	role: 'question_card',
	owner: 'claude',
	bounds: { x: 0, y: 300, w: 380, h: 320 },
	text: 'Which storage engine?',
	question: { options: ['SQLite', 'Postgres'], recommendation: 0 },
}
const node: CanvasShape = {
	id: 'shape:graph-node:storage',
	type: 'geo',
	role: 'decision_node',
	owner: 'claude',
	bounds: { x: 80, y: 0, w: 220, h: 80 },
	text: 'Storage engine',
	color: 'blue',
	decisionId: 'storage',
	status: 'open',
	onFrontier: true,
}
const note: CanvasShape = {
	id: 'shape:note1',
	type: 'note',
	role: 'sticky_note',
	owner: 'user',
	bounds: { x: 420, y: 320, w: 200, h: 200 },
	text: 'DuckDB, it is embedded and fast',
	color: 'yellow',
	anchor: {
		shapeId: card.id,
		role: 'question_card',
		relation: 'next_to',
		label: 'Which storage engine?',
	},
}
const scribble: CanvasShape = {
	id: 'shape:draw1',
	type: 'draw',
	role: 'drawing',
	owner: 'user',
	bounds: { x: 70, y: 10, w: 240, h: 60 },
	color: 'red',
	anchor: { shapeId: node.id, role: 'decision_node', relation: 'on', label: 'Storage engine' },
}

const readResult: CanvasCommandResult<'canvas.read'> = {
	region: { x: -32, y: -32, w: 684, h: 684 },
	shapes: [note, scribble, node, card],
	omitted: 0,
	screenshot: { mimeType: 'image/png', data: 'iVBORw0KGgo=', width: 684, height: 684 },
}

function answerRead(canvas: FakeCanvas, result = readResult) {
	canvas.respondWith((command) => makeOkResult(command.id, result))
}

describe('read_canvas', () => {
	it('is listed as a tool', async () => {
		const { tools } = await client.listTools()
		expect(tools.map((t) => t.name)).toContain('read_canvas')
	})

	it('reads the whole page with a screenshot by default', async () => {
		const canvas = await connectCanvas()
		answerRead(canvas)

		const result = await readCanvas()

		expect(result.isError).toBeFalsy()
		expect(canvas.commands).toHaveLength(1)
		expect(canvas.commands[0]).toMatchObject({
			name: 'canvas.read',
			payload: { region: 'all', screenshot: true },
		})
		expect(result.content).toContainEqual({
			type: 'image',
			data: 'iVBORw0KGgo=',
			mimeType: 'image/png',
		})
		expect(textOf(result)).toContain('Screenshot of the region attached (684 x 684 px)')
	})

	it('passes a region box and can skip the screenshot', async () => {
		const canvas = await connectCanvas()
		answerRead(canvas, { ...readResult, screenshot: null })

		const result = await readCanvas({
			region: { x: 10, y: 20, w: 300, h: 200 },
			screenshot: false,
		})

		expect(canvas.commands[0]?.payload).toEqual({
			region: { x: 10, y: 20, w: 300, h: 200 },
			screenshot: false,
		})
		expect(result.content.some((c) => c.type === 'image')).toBe(false)
	})

	it('describes a sticky note next to the question card as the user annotating it', async () => {
		const canvas = await connectCanvas()
		answerRead(canvas)

		const text = textOf(await readCanvas({ region: 'question' }))

		expect(text).toContain('Read region "question"')
		const noteLine = text.split('\n').find((line) => line.includes('sticky note')) ?? ''
		expect(noteLine).toContain('"DuckDB, it is embedded and fast"')
		expect(noteLine).toContain('next to question card "Which storage engine?"')
		const drawingLine = text.split('\n').find((line) => line.includes('drawing')) ?? ''
		expect(drawingLine).toContain('on decision node "Storage engine"')
	})

	it("lists the user's shapes apart from Claude's own", async () => {
		const canvas = await connectCanvas()
		answerRead(canvas)

		const text = textOf(await readCanvas())

		const [user, claude] = text.split('Your shapes')
		expect(user).toContain("User's shapes (not drawn by your tools): 2")
		expect(user).toContain('shape:note1')
		expect(claude).toContain('decision node "storage" "Storage engine" [open, frontier]')
		expect(claude).toContain('options: SQLite (recommended), Postgres; answer: none yet')
	})

	it('says so when the canvas is empty', async () => {
		const canvas = await connectCanvas()
		answerRead(canvas, { region: null, shapes: [], omitted: 0, screenshot: null })
		expect(textOf(await readCanvas())).toContain('The canvas is empty')
	})

	it('explains a missing screenshot and omitted shapes', async () => {
		const canvas = await connectCanvas()
		answerRead(canvas, {
			...readResult,
			screenshot: null,
			screenshotError: 'export failed',
			omitted: 3,
		})
		const text = textOf(await readCanvas())
		expect(text).toContain('No screenshot: export failed.')
		expect(text).toContain('3 more shapes are not listed')
	})

	it('rejects an invalid region', async () => {
		await connectCanvas()
		const result = await readCanvas({ region: 'everything' })
		expect(result.isError).toBe(true)
	})

	it('passes canvas-side failures through as tool errors', async () => {
		const canvas = await connectCanvas()
		canvas.failWith('handler_failed', 'There is no question card on the canvas.')
		const result = await readCanvas({ region: 'question' })
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('no question card')
	})

	it('reports a tool error when no canvas is connected', async () => {
		const result = await readCanvas()
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('not_connected')
	})
})

describe('canvas activity digest', () => {
	it('is appended to other tool results when the user changed the canvas', async () => {
		const canvas = await connectCanvas()
		canvas.activity = { added: { sticky_note: 2, drawing: 1 }, changed: 1, removed: 0 }

		const result = (await client.callTool({
			name: 'canvas_smoke_test',
			arguments: {},
		})) as CallToolResult

		expect(canvas.activityQueries).toBe(1)
		expect(textOf(result)).toContain(
			'Canvas activity since your last read_canvas: the user added 2 sticky notes, 1 drawing; moved or edited 1 shape. Call read_canvas to see it.',
		)
	})

	it('is left out when nothing happened', async () => {
		const canvas = await connectCanvas()
		const result = (await client.callTool({
			name: 'canvas_smoke_test',
			arguments: {},
		})) as CallToolResult
		expect(canvas.activityQueries).toBe(1)
		expect(textOf(result)).not.toContain('Canvas activity')
	})

	it('is not appended to read_canvas itself', async () => {
		const canvas = await connectCanvas()
		canvas.activity = { added: { sticky_note: 1 }, changed: 0, removed: 0 }
		answerRead(canvas)
		const result = await readCanvas()
		expect(canvas.activityQueries).toBe(0)
		expect(textOf(result)).not.toContain('Canvas activity')
	})

	it('counts deletions', () => {
		expect(describeActivity({ added: {}, changed: 0, removed: 2 })).toContain(
			'the user deleted 2 shapes.',
		)
		expect(describeActivity({ added: {}, changed: 0, removed: 0 })).toBeUndefined()
	})
})

describe('server instructions', () => {
	it('tell Claude to read the canvas at every step', () => {
		expect(client.getInstructions()).toContain('Call read_canvas')
	})
})
