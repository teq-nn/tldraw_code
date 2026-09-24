import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { type CommandEnvelope, makeOkResult } from '@tldraw-code/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { createMcpServer } from '../src/server'
import { FakeCanvas } from './fakeCanvas'

// `ask` through the public seam: MCP tool call in, `ask.show` command out,
// the fake canvas plays the user by sending `ask.answered` events.

const ASK_TIMEOUT_MS = 300

let bridge: CanvasBridge
let port: number
let client: Client
const canvases: FakeCanvas[] = []

const question = {
	question: 'Which storage engine?',
	options: ['SQLite', 'Postgres', 'Files'],
	recommendation: 'SQLite',
}

beforeEach(async () => {
	bridge = new CanvasBridge({ port: 0, requestTimeoutMs: 200 })
	port = await bridge.start()
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await createMcpServer(bridge, {
		ask: { timeoutMs: ASK_TIMEOUT_MS, heartbeatMs: 50 },
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

async function waitFor(condition: () => boolean): Promise<void> {
	for (let i = 0; i < 200 && !condition(); i++) await new Promise((r) => setTimeout(r, 5))
	if (!condition()) throw new Error('condition not met')
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
		await new Promise((r) => setTimeout(r, 50))
		expect(settled).toBe(false)

		canvas.sendEvent('ask.answered', { askId, answer: { kind: 'option', option: 1 } })

		const result = await pending
		expect(result.isError).toBeFalsy()
		expect(textOf(result)).toBe('The user chose: Postgres.')
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
		const started = Date.now()
		const result = await ask()
		expect(Date.now() - started).toBeGreaterThanOrEqual(ASK_TIMEOUT_MS - 20)
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
		const first = await ask()
		expect(textOf(first)).toContain('No answer yet')
		canvas.sendEvent('ask.answered', {
			askId: askIdOf(await shown(canvas)),
			answer: { kind: 'option', option: 1 },
		})
		await new Promise((r) => setTimeout(r, 30))

		const result = await ask()
		expect(textOf(result)).toBe('The user chose: Postgres.')
		expect(canvas.commands).toHaveLength(1)
	})

	it('keeps only one question open: a different question replaces the card', async () => {
		const canvas = await connectCanvas()
		await ask() // times out
		const firstId = askIdOf(await shown(canvas))

		const pending = ask({ ...question, question: 'Which ORM?' })
		const secondId = askIdOf(await shown(canvas, 2))
		expect(secondId).not.toBe(firstId)

		// A late click on the replaced card is ignored.
		canvas.sendEvent('ask.answered', { askId: firstId, answer: { kind: 'option', option: 0 } })
		await new Promise((r) => setTimeout(r, 30))
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
		const result = await ask(question, { onprogress: (p) => progress.push(p.progress) })
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
