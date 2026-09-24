import {
	type CommandEnvelope,
	type Envelope,
	encodeEnvelope,
	makeCommand,
	parseEnvelope,
	type ResultEnvelope,
} from '@tldraw-code/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type WebSocket as ServerSocket, WebSocketServer } from 'ws'
import { BridgeClient, type BridgeStatus, type CommandHandlers } from '../src/bridge/BridgeClient'

// A tiny stand-in for the MCP server's bridge, so the client is tested over a real socket.
let wss: WebSocketServer
let url: string
let received: Envelope[]
let client: BridgeClient | undefined

function nextConnection(): Promise<ServerSocket> {
	return new Promise((resolve) => wss.once('connection', resolve))
}

function send(socket: ServerSocket, command: CommandEnvelope): Promise<ResultEnvelope> {
	return new Promise((resolve) => {
		const onMessage = (data: unknown) => {
			const parsed = parseEnvelope(String(data))
			if (parsed.ok && parsed.envelope.kind === 'result' && parsed.envelope.id === command.id) {
				socket.off('message', onMessage)
				resolve(parsed.envelope)
			}
		}
		socket.on('message', onMessage)
		socket.send(encodeEnvelope(command))
	})
}

function startClient(handlers?: Partial<CommandHandlers>, statuses: BridgeStatus[] = []) {
	client = new BridgeClient({
		url,
		handlers: {
			'smoke.create_shape': ({ text }) => ({ shapeId: `shape:${text}` }),
			'graph.render': () => {
				throw new Error('not used in these tests')
			},
			'diagram.render': () => {
				throw new Error('not used in these tests')
			},
			'ask.show': () => {
				throw new Error('not used in these tests')
			},
			'canvas.read': () => {
				throw new Error('not used in these tests')
			},
			'canvas.activity': () => ({ added: {}, changed: 0, removed: 0 }),
			...handlers,
		},
		onStatusChange: (s) => statuses.push(s),
		reconnectDelayMs: 10,
	})
	client.start()
	return client
}

beforeEach(async () => {
	received = []
	wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
	await new Promise<void>((resolve) => wss.once('listening', () => resolve()))
	const address = wss.address()
	if (typeof address !== 'object' || !address) throw new Error('no address')
	url = `ws://127.0.0.1:${address.port}`
	wss.on('connection', (socket) =>
		socket.on('message', (data) => {
			const parsed = parseEnvelope(String(data))
			if (parsed.ok) received.push(parsed.envelope)
		}),
	)
})

afterEach(async () => {
	client?.stop()
	client = undefined
	for (const socket of wss.clients) socket.terminate()
	await new Promise<void>((resolve) => wss.close(() => resolve()))
})

describe('BridgeClient', () => {
	it('announces itself with a hello event and reports connected', async () => {
		const statuses: BridgeStatus[] = []
		const connection = nextConnection()
		startClient({}, statuses)
		await connection
		await expect
			.poll(() => received)
			.toContainEqual({
				v: 1,
				kind: 'event',
				name: 'hello',
				payload: { client: 'canvas' },
			})
		expect(statuses).toEqual(['connecting', 'connected'])
	})

	it('executes a command and answers with its result', async () => {
		const connection = nextConnection()
		startClient()
		const socket = await connection
		const result = await send(socket, makeCommand('c1', 'smoke.create_shape', { text: 'hi' }))
		expect(result).toEqual({
			v: 1,
			kind: 'result',
			id: 'c1',
			ok: true,
			payload: { shapeId: 'shape:hi' },
		})
	})

	it('answers unknown commands with an error result', async () => {
		const connection = nextConnection()
		startClient()
		const socket = await connection
		const result = await send(socket, makeCommand('c2', 'does.not_exist', {}))
		expect(result).toMatchObject({ ok: false, error: { code: 'unknown_command' } })
	})

	it('answers invalid payloads with an error result', async () => {
		const connection = nextConnection()
		startClient()
		const socket = await connection
		const result = await send(socket, makeCommand('c3', 'smoke.create_shape', { text: 42 }))
		expect(result).toMatchObject({ ok: false, error: { code: 'invalid_payload' } })
	})

	it('reports a throwing handler as an error result', async () => {
		const connection = nextConnection()
		startClient({
			'smoke.create_shape': () => {
				throw new Error('boom')
			},
		})
		const socket = await connection
		const result = await send(socket, makeCommand('c4', 'smoke.create_shape', { text: 'x' }))
		expect(result).toMatchObject({ ok: false, error: { code: 'handler_failed', message: 'boom' } })
	})

	it('reconnects after the server drops the connection', async () => {
		const first = nextConnection()
		startClient()
		const socket = await first
		const second = nextConnection()
		socket.terminate()
		await expect(second).resolves.toBeDefined()
		await expect.poll(() => client?.getStatus()).toBe('connected')
	})

	it('sends events to the server once connected, and drops them before', async () => {
		const connection = nextConnection()
		const bridge = startClient()
		const answer = { askId: 'q1', answer: { kind: 'keep_grilling' as const } }
		expect(bridge.sendEvent('ask.answered', answer)).toBe(false)
		await connection
		await expect.poll(() => bridge.getStatus()).toBe('connected')

		expect(bridge.sendEvent('ask.answered', answer)).toBe(true)
		await expect
			.poll(() => received)
			.toContainEqual({ v: 1, kind: 'event', name: 'ask.answered', payload: answer })
	})
})
