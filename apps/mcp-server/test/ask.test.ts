import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { type CommandEnvelope, makeOkResult } from '@tldraw-code/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { createMcpServer } from '../src/server'
import { FakeCanvas } from './fakeCanvas'
import { ManualClock, nextEvent, waitFor } from './timing'

// `ask` through the public seam: MCP tool call in, `ask.show` command out,
// the fake canvas plays the user by sending `ask.answered` events. Time-outs
// fire when the test advances a manual clock, so no test depends on speed.

const ASK_TIMEOUT_MS = 300

let bridge: CanvasBridge
let port: number
let client: Client
let clock: ManualClock
const canvases: FakeCanvas[] = []

const question = {
	question: 'Which storage engine?',
	options: ['SQLite', 'Postgres', 'Files'],
	recommendation: 'SQLite',
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

/** A fake canvas that acknowledges every `ask.show` like the real one. */
async function connectCanvas(): Promise<FakeCanvas> {
	const canvas = await FakeCanvas.connect(port)
	canvases.push(canvas)
	canvas.respondWith((command) =>
		makeOkResult(command.id, { shapeId: 'shape:question-card', created: true }),
	)
	await waitFor(() => bridge.isConnected())
	return canvas
}

function ask(
	args: Record<string, unknown> = question,
	options: Parameters<Client['callTool']>[2] = {},
): Promise<CallToolResult> {
	return client.callTool(
		{ name: 'ask', arguments: args },
		undefined,
		options,
	) as Promise<CallToolResult>
}

/** An `ask` call the user does not answer: it returns once the clock passes the timeout. */
async function askUntilTimeout(args: Record<string, unknown> = question): Promise<CallToolResult> {
	const pending = ask(args)
	await clock.whenArmed()
	clock.advance(ASK_TIMEOUT_MS)
	return pending
}

/** Send an answer and wait until the server has handled it. */
async function answerAndWait(canvas: FakeCanvas, payload: unknown): Promise<void> {
	const handled = nextEvent(bridge, 'ask.answered')
	canvas.sendEvent('ask.answered', payload)
	await handled
}

function textOf(result: CallToolResult): string {
	return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
}

/** Wait until the canvas has received `count` commands and return the last one. */
async function shown(canvas: FakeCanvas, count = 1): Promise<CommandEnvelope> {
	await waitFor(() => canvas.commands.length >= count)
	const command = canvas.commands[count - 1]
	if (!command) throw new Error('no command')
	return command
}

function askIdOf(command: CommandEnvelope): string {
	return (command.payload as { askId: string }).askId
}

describe('ask', () => {
	it('is listed as a tool', async () => {
		const { tools } = await client.listTools()
		expect(tools.map((t) => t.name)).toContain('ask')
	})

	it('shows a question card with the options and the recommendation marked', async () => {
		const canvas = await connectCanvas()
		const pending = ask()
		const command = await shown(canvas)
		expect(command).toMatchObject({
			name: 'ask.show',
			payload: {
				question: 'Which storage engine?',
				options: ['SQLite', 'Postgres', 'Files'],
				recommendation: 0,
			},
		})
		expect(askIdOf(command)).toMatch(/^[A-Za-z0-9_-]+$/)
		canvas.sendEvent('ask.answered', { askId: askIdOf(command), answer: { kind: 'keep_grilling' } })
		await pending
	})

	it('blocks until the user clicks an option and returns that option', async () => {
		const canvas = await connectCanvas()
		let settled = false
		const pending = ask().then((result) => {
			settled = true
			return result
		})
		const askId = askIdOf(await shown(canvas))
		await clock.whenArmed()
		clock.advance(ASK_TIMEOUT_MS - 1)
		await new Promise((r) => setImmediate(r))
		expect(settled).toBe(false)

		canvas.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 1 } })

		const result = await pending
		expect(result.isError).toBeFalsy()
		expect(textOf(result)).toBe('The user chose: Postgres.')
	})

	it('keeps an answer that arrives right behind the acknowledgement of the card', async () => {
		const canvas = await connectCanvas()
		canvas.respondWith((command) => {
			// The user clicks before the server has even seen the card acknowledged.
			const { askId } = command.payload as { askId: string }
			queueMicrotask(() =>
				canvas.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 2 } }),
			)
			return makeOkResult(command.id, { shapeId: 'shape:question-card', created: true })
		})
		expect(textOf(await ask())).toBe('The user chose: Files.')
	})

	it('says when the user followed the recommendation', async () => {
		const canvas = await connectCanvas()
		const pending = ask()
		const askId = askIdOf(await shown(canvas))
		canvas.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 0 } })
		expect(textOf(await pending)).toBe('The user chose: SQLite (your recommendation).')
	})

	it('returns "Keep grilling" and sticky-note answers', async () => {
		const canvas = await connectCanvas()
		const first = ask()
		canvas.sendEvent('ask.answered', {
			askId: askIdOf(await shown(canvas)),
			answer: { kind: 'keep_grilling' },
		})
		expect(textOf(await first)).toContain('Keep grilling')

		const second = ask()
		canvas.sendEvent('ask.answered', {
			askId: askIdOf(await shown(canvas, 2)),
			answer: { kind: 'note', text: 'Whatever the team knows' },
		})
		expect(textOf(await second)).toContain('sticky note')
		expect(textOf(await second)).toContain('"Whatever the team knows"')
	})

	it('returns "no answer yet" after the timeout without failing, and keeps the card open', async () => {
		const canvas = await connectCanvas()
		const result = await askUntilTimeout()
		expect(result.isError).toBeFalsy()
		expect(textOf(result)).toContain('No answer yet')
		expect(textOf(result)).toContain('call ask again')

		// The session goes on: other tools and further asks still work.
		const again = ask()
		const command = await shown(canvas, 2)
		expect(askIdOf(command)).toBe(askIdOf(canvas.commands[0] as CommandEnvelope))
		canvas.sendEvent('ask.answered', {
			askId: askIdOf(command),
			answer: { kind: 'option', option: 2 },
		})
		expect(textOf(await again)).toBe('The user chose: Files.')
	})

	it('returns an answer given after a timeout at once when the same question is asked again', async () => {
		const canvas = await connectCanvas()
		const first = await askUntilTimeout()
		expect(textOf(first)).toContain('No answer yet')
		await answerAndWait(canvas, {
			askId: askIdOf(await shown(canvas)),
			answer: { kind: 'option', option: 1 },
		})

		const result = await ask()
		expect(textOf(result)).toBe('The user chose: Postgres.')
		expect(canvas.commands).toHaveLength(1)
	})

	it('keeps only one question open: a different question replaces the card', async () => {
		const canvas = await connectCanvas()
		await askUntilTimeout()
		const firstId = askIdOf(await shown(canvas))

		const pending = ask({ ...question, question: 'Which ORM?' })
		const secondId = askIdOf(await shown(canvas, 2))
		expect(secondId).not.toBe(firstId)

		// A late click on the replaced card is ignored.
		await answerAndWait(canvas, { askId: firstId, answer: { kind: 'option', option: 0 } })
		canvas.sendEvent('ask.answered', { askId: secondId, answer: { kind: 'option', option: 1 } })
		expect(textOf(await pending)).toBe('The user chose: Postgres.')
	})

	it('refuses a second ask while one is still waiting', async () => {
		const canvas = await connectCanvas()
		const first = ask()
		const askId = askIdOf(await shown(canvas))

		const second = await ask({ ...question, question: 'Which ORM?' })
		expect(second.isError).toBe(true)
		expect(textOf(second)).toContain('ask_in_progress')
		expect(canvas.commands).toHaveLength(1)

		canvas.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 0 } })
		expect(textOf(await first)).toContain('SQLite')
	})

	it('keeps waiting when the canvas tab reloads, and takes the answer from the new tab', async () => {
		const canvas = await connectCanvas()
		const pending = ask()
		const askId = askIdOf(await shown(canvas))
		await canvas.close()

		const reloaded = await connectCanvas()
		reloaded.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 2 } })
		expect(textOf(await pending)).toBe('The user chose: Files.')
	})

	it('ignores duplicate and malformed answers', async () => {
		const canvas = await connectCanvas()
		const pending = ask()
		const askId = askIdOf(await shown(canvas))
		canvas.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 3 } }) // no 4th option
		canvas.sendEvent('ask.answered', { askId, answer: { kind: 'shrug' } })
		canvas.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 1 } })
		canvas.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 0 } })
		expect(textOf(await pending)).toBe('The user chose: Postgres.')
	})

	it('reports progress while it waits', async () => {
		await connectCanvas()
		const progress: number[] = []
		const pending = ask(question, { onprogress: (p) => progress.push(p.progress) })
		await clock.whenArmed()
		clock.advance(ASK_TIMEOUT_MS)
		const result = await pending
		expect(textOf(result)).toContain('No answer yet')
		expect(progress.length).toBeGreaterThanOrEqual(2)
	})

	it('stops waiting when the tool call is cancelled', async () => {
		const canvas = await connectCanvas()
		const controller = new AbortController()
		const pending = ask(question, { signal: controller.signal })
		await shown(canvas)
		controller.abort()
		await expect(pending).rejects.toThrow()

		// The next call is not refused as "in progress".
		const next = ask()
		const command = await shown(canvas, 2)
		canvas.sendEvent('ask.answered', {
			askId: askIdOf(command),
			answer: { kind: 'option', option: 0 },
		})
		expect((await next).isError).toBeFalsy()
	})

	it.each([
		['a recommendation that is not an option', { ...question, recommendation: 'MySQL' }],
		['a single option', { ...question, options: ['SQLite'] }],
		['five options', { ...question, options: ['SQLite', 'B', 'C', 'D', 'E'] }],
		['duplicate options', { ...question, options: ['SQLite', 'SQLite'] }],
	])('rejects %s without touching the canvas', async (_name, args) => {
		const canvas = await connectCanvas()
		const result = await ask(args)
		expect(result.isError).toBe(true)
		expect(canvas.commands).toHaveLength(0)
	})

	it('reports a tool error when no canvas is connected', async () => {
		const result = await ask()
		expect(result.isError).toBe(true)
		expect(textOf(result)).toContain('not_connected')
	})
})

// ADR 0010: once Claude has the answer, the next render_graph collapses the card.
describe('collapsing the answered question card', () => {
	const graph = { nodes: [{ id: 'storage', title: 'Storage', status: 'open' }] }
	const resolved = {
		nodes: [{ id: 'storage', title: 'Storage', status: 'resolved', note: 'SQLite' }],
	}

	/** Acknowledges `ask.show` and `graph.render` like the real canvas; collapses whatever it is asked to. */
	async function connectFullCanvas(): Promise<FakeCanvas> {
		const canvas = await connectCanvas()
		respondLikeCanvas(canvas)
		return canvas
	}

	function respondLikeCanvas(canvas: FakeCanvas): void {
		const counts = { created: 0, updated: 1, removed: 0 }
		canvas.respondWith((command) =>
			command.name === 'graph.render'
				? makeOkResult(command.id, {
						nodes: counts,
						edges: counts,
						questionCollapsed: 'collapseQuestion' in (command.payload as object),
					})
				: makeOkResult(command.id, { shapeId: 'shape:question-card', created: true }),
		)
	}

	function renderGraph(args: Record<string, unknown>): Promise<CallToolResult> {
		return client.callTool({ name: 'render_graph', arguments: args }) as Promise<CallToolResult>
	}

	function renders(canvas: FakeCanvas): CommandEnvelope[] {
		return canvas.commands.filter((command) => command.name === 'graph.render')
	}

	it('asks the canvas to collapse the card whose answer ask returned, once', async () => {
		const canvas = await connectFullCanvas()
		await renderGraph(graph)
		const pending = ask()
		const askId = askIdOf(await shown(canvas, 2))
		canvas.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 0 } })
		await pending

		const result = await renderGraph(resolved)
		expect(renders(canvas)[1]?.payload).toMatchObject({ collapseQuestion: askId })
		expect(textOf(result)).toContain('Removed the answered question card')

		await renderGraph(resolved)
		expect(renders(canvas)[2]?.payload).not.toHaveProperty('collapseQuestion')
	})

	it('also collapses an answer that ask returned after a timeout', async () => {
		const canvas = await connectFullCanvas()
		await askUntilTimeout()
		const askId = askIdOf(await shown(canvas))
		await answerAndWait(canvas, { askId, answer: { kind: 'keep_grilling' } })
		await ask() // returns the buffered answer

		await renderGraph(graph)
		expect(renders(canvas)[0]?.payload).toMatchObject({ collapseQuestion: askId })
	})

	it('never collapses a card whose answer Claude has not received', async () => {
		const canvas = await connectFullCanvas()
		await askUntilTimeout() // the card stays open
		const askId = askIdOf(await shown(canvas))
		// The user answers, but Claude renders before asking again: the answer must survive.
		await answerAndWait(canvas, { askId, answer: { kind: 'option', option: 1 } })

		const result = await renderGraph(graph)
		expect(renders(canvas)[0]?.payload).not.toHaveProperty('collapseQuestion')
		expect(textOf(result)).not.toContain('Removed')
		expect(textOf(await ask())).toBe('The user chose: Postgres.')
	})

	it('offers the card again after a failed render', async () => {
		const canvas = await connectFullCanvas()
		const pending = ask()
		const askId = askIdOf(await shown(canvas))
		canvas.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 0 } })
		await pending

		canvas.failWith('handler_failed', 'boom')
		expect((await renderGraph(resolved)).isError).toBe(true)
		const failed = canvas.commands.length
		respondLikeCanvas(canvas)
		await renderGraph(resolved)
		expect(canvas.commands[failed]?.payload).toMatchObject({ collapseQuestion: askId })
	})

	it('stops offering the card once a new question has replaced it', async () => {
		const canvas = await connectFullCanvas()
		const pending = ask()
		const askId = askIdOf(await shown(canvas))
		canvas.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 0 } })
		await pending

		await askUntilTimeout({ ...question, question: 'Which ORM?' }) // replaces the card
		await renderGraph(graph)
		expect(renders(canvas)[0]?.payload).not.toHaveProperty('collapseQuestion')
	})
})
