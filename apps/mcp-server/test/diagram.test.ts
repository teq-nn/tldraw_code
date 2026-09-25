import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { type CommandEnvelope, makeOkResult } from '@tldraw-code/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { createMcpServer } from '../src/server'
import { FakeCanvas } from './fakeCanvas'
import { ManualClock, nextEvent, waitFor } from './timing'

// render_diagram and compare through the public seam: MCP tool calls in,
// `diagram.render` / `ask.show` commands out, the fake canvas plays the user.

const ASK_TIMEOUT_MS = 300

let bridge: CanvasBridge
let port: number
let client: Client
let clock: ManualClock
const canvases: FakeCanvas[] = []

const direct = {
	nodes: [
		{ id: 'api', label: 'API' },
		{ id: 'db', label: 'Database', look: 'ellipse' },
	],
	edges: [{ from: 'api', to: 'db' }],
}

const queued = {
	nodes: [
		{ id: 'api', label: 'API' },
		{ id: 'queue', label: 'Queue' },
		{ id: 'db', label: 'Database', look: 'ellipse' },
	],
	edges: [
		{ from: 'api', to: 'queue' },
		{ from: 'queue', to: 'db' },
	],
}

const comparison = {
	id: 'ingest',
	question: 'Which data flow?',
	items: [
		{ label: 'Direct', spec: direct },
		{ label: 'Queued', caption: 'Writes go through a queue.', spec: queued },
	],
	recommendation: 'Queued',
}

beforeEach(async () => {
	bridge = new CanvasBridge({ port: 0, requestTimeoutMs: 5000 })
	port = await bridge.start()
	clock = new ManualClock()
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await createMcpServer(bridge, {
		ask: { timeoutMs: ASK_TIMEOUT_MS, heartbeatMs: 50 },
		clock,
	}).connect(serverTransport)
	client = new Client({ name: 'test', version: '0.0.0' })
	await client.connect(clientTransport)
})

afterEach(async () => {
	await client.close()
	await Promise.all(canvases.splice(0).map((c) => c.close()))
	await bridge.stop()
})

/** A fake canvas that answers `diagram.render` and `ask.show` like the real one. */
async function connectCanvas(): Promise<FakeCanvas> {
	const canvas = await FakeCanvas.connect(port)
	canvases.push(canvas)
	canvas.respondWith((command) => {
		if (command.name === 'diagram.render') {
			const { frames } = command.payload as { frames: unknown[] }
			return makeOkResult(command.id, {
				frameIds: frames.map((_, index) => `shape:frame-${index}`),
				nodes: { created: 3, updated: 0, removed: 0 },
				edges: { created: 2, updated: 0, removed: 0 },
			})
		}
		if (command.name === 'prototype.render') {
			const { id } = command.payload as { id: string }
			return makeOkResult(command.id, {
				shapeId: `shape:prototype:${id}`,
				created: true,
				bounds: { x: 0, y: 0, w: 480, h: 416 },
				width: 480,
				height: 360,
			})
		}
		if (command.name === 'comparison.settle') {
			return makeOkResult(command.id, {
				kind: 'diagram',
				chosenFrameId: 'shape:frame-1',
				rejectedFrameIds: ['shape:frame-0'],
				pinId: 'shape:choice-pin:ingest',
			})
		}
		return makeOkResult(command.id, { shapeId: 'shape:question-card', created: true })
	})
	await waitFor(() => bridge.isConnected())
	return canvas
}

function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
	return client.callTool({ name, arguments: args }) as Promise<CallToolResult>
}

function textOf(result: CallToolResult): string {
	return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
}

async function command(canvas: FakeCanvas, index: number): Promise<CommandEnvelope> {
	await waitFor(() => canvas.commands.length > index)
	const found = canvas.commands[index]
	if (!found) throw new Error('no command')
	return found
}

function askIdOf(envelope: CommandEnvelope): string {
	return (envelope.payload as { askId: string }).askId
}

describe('render_diagram', () => {
	it('is listed as a tool', async () => {
		const { tools } = await client.listTools()
		expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['render_diagram', 'compare']))
	})

	it('sends the diagram as one frame without highlights and reports it', async () => {
		const canvas = await connectCanvas()
		const result = await call('render_diagram', { id: 'flow', title: 'Data flow', spec: queued })

		expect(result.isError).toBeFalsy()
		expect(canvas.commands[0]).toMatchObject({
			name: 'diagram.render',
			payload: {
				kind: 'diagram',
				id: 'flow',
				frames: [
					{
						title: 'Data flow',
						nodes: queued.nodes,
						edges: queued.edges,
						highlight: { nodes: [], edges: [] },
					},
				],
			},
		})
		expect(textOf(result)).toContain('Rendered diagram "flow" in frame shape:frame-0')
		expect(textOf(result)).toContain('3 nodes')
	})

	it('titles the frame with the id when no title is given', async () => {
		const canvas = await connectCanvas()
		await call('render_diagram', { id: 'flow', spec: direct })
		expect(canvas.commands[0]?.payload).toMatchObject({ frames: [{ title: 'flow' }] })
	})

	it('rejects an invalid spec without touching the canvas', async () => {
		const canvas = await connectCanvas()
		const result = await call('render_diagram', {
			id: 'flow',
			spec: { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'nope' }] },
		})
		expect(result.isError).toBe(true)
		expect(textOf(result)).toMatch(/^\[invalid_diagram\] spec\.edges\.0\.to/)
		expect(canvas.commands).toHaveLength(0)
	})

	it('reports a missing canvas as not_connected', async () => {
		const result = await call('render_diagram', { id: 'flow', spec: direct })
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('[not_connected]')
	})
})

describe('compare', () => {
	it('renders the alternatives side by side with their differences highlighted, then asks', async () => {
		const canvas = await connectCanvas()
		const pending = call('compare', comparison)

		const render = await command(canvas, 0)
		expect(render).toMatchObject({
			name: 'diagram.render',
			payload: {
				kind: 'comparison',
				id: 'ingest',
				frames: [
					{ title: 'Direct', highlight: { nodes: [], edges: ['api->db'] } },
					{
						title: 'Queued',
						caption: 'Writes go through a queue.',
						highlight: { nodes: ['queue'], edges: ['api->queue', 'queue->db'] },
					},
				],
			},
		})

		const show = await command(canvas, 1)
		expect(show).toMatchObject({
			name: 'ask.show',
			payload: {
				question: 'Which data flow?',
				options: ['Direct', 'Queued'],
				recommendation: 1,
				comparison: 'ingest',
			},
		})

		canvas.sendEvent('ask.answered', {
			askId: askIdOf(show),
			answer: { kind: 'option', option: 1 },
		})
		const result = await pending
		expect(result.isError).toBeFalsy()
		const text = textOf(result)
		expect(text).toContain('Showing 2 alternatives side by side')
		expect(text).toContain('- Queued: nodes queue; edges api->queue, queue->db')
		expect(text).toContain('- Direct: edges api->db')
		expect(text).toContain('The user chose: Queued (your recommendation).')
	})

	it('returns a sticky-note answer as the answer', async () => {
		const canvas = await connectCanvas()
		const pending = call('compare', comparison)
		const show = await command(canvas, 1)
		canvas.sendEvent('ask.answered', {
			askId: askIdOf(show),
			answer: { kind: 'note', text: 'Queued, but batch the writes' },
		})
		expect(textOf(await pending)).toContain('"Queued, but batch the writes"')
	})

	it('says when the alternatives do not differ', async () => {
		const canvas = await connectCanvas()
		const pending = call('compare', {
			...comparison,
			items: [
				{ label: 'Direct', spec: direct },
				{ label: 'Same', spec: direct },
			],
			recommendation: 'Direct',
		})
		const show = await command(canvas, 1)
		canvas.sendEvent('ask.answered', { askId: askIdOf(show), answer: { kind: 'keep_grilling' } })
		const text = textOf(await pending)
		expect(text).toContain('nothing is highlighted')
		expect(text).toContain('Keep grilling')
	})

	it('after "no answer yet", the same call keeps waiting on the same card', async () => {
		const canvas = await connectCanvas()
		const pending = call('compare', comparison)
		await clock.whenArmed()
		clock.advance(ASK_TIMEOUT_MS)
		const first = await pending
		expect(textOf(first)).toContain('No answer yet')
		expect(textOf(first)).toContain('call compare again with exactly the same arguments')
		const askId = askIdOf(await command(canvas, 1))

		// The user answers while no call waits; the next identical call returns it at once.
		const handled = nextEvent(bridge, 'ask.answered')
		canvas.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 0 } })
		await handled
		const second = await call('compare', comparison)
		expect(textOf(second)).toContain('The user chose: Direct.')
		// The frames were re-rendered in place (same kind and id), and no second card was shown.
		expect(canvas.commands.map((c) => c.name)).toEqual([
			'diagram.render',
			'ask.show',
			'diagram.render',
		])
	})

	it('collapses its answered card on the next render_graph', async () => {
		const canvas = await connectCanvas()
		const pending = call('compare', comparison)
		const show = await command(canvas, 1)
		canvas.sendEvent('ask.answered', {
			askId: askIdOf(show),
			answer: { kind: 'option', option: 0 },
		})
		await pending

		canvas.respondWith((envelope) =>
			makeOkResult(envelope.id, {
				nodes: { created: 0, updated: 1, removed: 0 },
				edges: { created: 0, updated: 0, removed: 0 },
				questionCollapsed: true,
			}),
		)
		await call('render_graph', {
			nodes: [{ id: 'ingest', title: 'Data flow', status: 'resolved', note: 'Direct' }],
		})
		expect(canvas.commands[2]?.payload).toMatchObject({ collapseQuestion: askIdOf(show) })
	})

	it('rejects invalid input without touching the canvas', async () => {
		const canvas = await connectCanvas()
		const result = await call('compare', { ...comparison, recommendation: 'Batched' })
		expect(result.isError).toBe(true)
		expect(textOf(result)).toMatch(/^\[invalid_comparison\] recommendation/)
		const tooFew = await call('compare', { ...comparison, items: [comparison.items[0]] })
		expect(tooFew.isError).toBe(true)
		expect(canvas.commands).toHaveLength(0)
	})

	it('refuses while another question is waiting, before drawing anything', async () => {
		const canvas = await connectCanvas()
		const waiting = call('ask', {
			question: 'Which storage?',
			options: ['SQLite', 'Postgres'],
			recommendation: 'SQLite',
		})
		const show = await command(canvas, 0)

		const result = await call('compare', comparison)
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('[ask_in_progress]')
		expect(canvas.commands).toHaveLength(1)

		canvas.sendEvent('ask.answered', { askId: askIdOf(show), answer: { kind: 'keep_grilling' } })
		await waiting
	})
})

describe('compare with prototypes (ADR 0020)', () => {
	const tabs = '<!doctype html><p>Tabs</p>'
	const single = '<!doctype html><p>Single form</p>'
	const uiComparison = {
		id: 'login',
		question: 'Which login screen?',
		items: [
			{ label: 'Tabs', caption: 'Sign in and sign up as tabs.', html: tabs },
			{ label: 'Single form', html: single, width: 400, height: 300 },
		],
		recommendation: 'Single form',
	}

	it('shows each alternative as a prototype of the comparison, then asks below them', async () => {
		const canvas = await connectCanvas()
		const pending = call('compare', uiComparison)
		const show = await command(canvas, 2)
		expect(canvas.commands.slice(0, 2)).toMatchObject([
			{
				name: 'prototype.render',
				payload: {
					id: 'login-tabs',
					label: 'Tabs',
					caption: 'Sign in and sign up as tabs.',
					html: tabs,
					comparison: { id: 'login', index: 0 },
				},
			},
			{
				name: 'prototype.render',
				payload: {
					id: 'login-single-form',
					html: single,
					width: 400,
					height: 300,
					comparison: { id: 'login', index: 1 },
				},
			},
		])
		expect(show).toMatchObject({
			name: 'ask.show',
			payload: { options: ['Tabs', 'Single form'], recommendation: 1, comparison: 'login' },
		})
		canvas.sendEvent('ask.answered', {
			askId: askIdOf(show),
			answer: { kind: 'option', option: 0 },
		})
		const text = textOf(await pending)
		expect(text).toContain('Showing 2 prototypes side by side for "login"')
		expect(text).toContain('- Tabs: prototype "login-tabs"')
		expect(text).toContain('The user chose: Tabs.')
		expect(text).toContain('call settle_comparison with id "login"')
	})

	it('uses the prototype ids given', async () => {
		const canvas = await connectCanvas()
		const items = uiComparison.items.map((item, index) => ({ ...item, id: `v${index}` }))
		const pending = call('compare', { ...uiComparison, items })
		const show = await command(canvas, 2)
		expect(canvas.commands.map((c) => (c.payload as { id?: string }).id).slice(0, 2)).toEqual([
			'v0',
			'v1',
		])
		canvas.sendEvent('ask.answered', { askId: askIdOf(show), answer: { kind: 'keep_grilling' } })
		expect(textOf(await pending)).not.toContain('settle_comparison')
	})

	it.each([
		[
			'diagrams mixed with prototypes',
			{
				items: [
					{ label: 'Tabs', html: tabs },
					{ label: 'Flow', spec: direct },
				],
			},
		],
		[
			'an item with both spec and html',
			{ items: [{ label: 'Tabs', html: tabs, spec: direct }, uiComparison.items[1]] },
		],
		['an item with neither', { items: [{ label: 'Tabs' }, uiComparison.items[1]] }],
		[
			'a prototype size on a diagram',
			{
				items: [
					{ label: 'Direct', spec: direct, width: 400 },
					{ label: 'Single form', spec: queued },
				],
			},
		],
	])('rejects %s without touching the canvas', async (_name, change) => {
		const canvas = await connectCanvas()
		const result = await call('compare', { ...uiComparison, ...change })
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('[invalid_comparison]')
		expect(canvas.commands).toHaveLength(0)
	})
})

describe('settle_comparison (ADR 0021)', () => {
	const choice = {
		id: 'ingest',
		chosen: 'Queued',
		rejected: [{ label: 'Direct', reason: 'Writes block the request' }],
	}

	it('asks the canvas to settle the comparison, pinned to the node of the same id by default', async () => {
		const canvas = await connectCanvas()
		const result = await call('settle_comparison', choice)
		expect(canvas.commands[0]).toMatchObject({
			name: 'comparison.settle',
			payload: { ...choice, node: 'ingest' },
		})
		expect(textOf(result)).toContain('"Queued" is marked chosen')
		expect(textOf(result)).toContain('Pinned to decision node "ingest"')
	})

	it('pins to the node given', async () => {
		const canvas = await connectCanvas()
		await call('settle_comparison', { ...choice, node: '12' })
		expect(canvas.commands[0]?.payload).toMatchObject({ node: '12' })
	})

	it('says when there was no node to pin to', async () => {
		const canvas = await connectCanvas()
		canvas.respondWith((envelope) =>
			makeOkResult(envelope.id, {
				kind: 'diagram',
				chosenFrameId: 'shape:frame-1',
				rejectedFrameIds: ['shape:frame-0'],
				pinId: null,
			}),
		)
		expect(textOf(await call('settle_comparison', choice))).toContain('nothing is pinned')
	})

	it('passes the canvas refusal on, e.g. a missing reason', async () => {
		const canvas = await connectCanvas()
		canvas.failWith('handler_failed', 'Give a reason for every alternative that was not chosen')
		const result = await call('settle_comparison', choice)
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('Give a reason')
	})

	it.each([
		['the chosen alternative among the rejected', { rejected: [{ label: 'queued', reason: 'x' }] }],
		['no rejected alternative', { rejected: [] }],
		['a rejected alternative without a reason', { rejected: [{ label: 'Direct', reason: '' }] }],
	])('rejects %s without touching the canvas', async (_name, change) => {
		const canvas = await connectCanvas()
		const result = await call('settle_comparison', { ...choice, ...change })
		expect(result.isError).toBe(true)
		// Shape errors are caught by the SDK's input validation, cross-field ones by the tool.
		expect(textOf(result)).toMatch(/\[invalid_choice\]|Input validation error/)
		expect(canvas.commands).toHaveLength(0)
	})
})
