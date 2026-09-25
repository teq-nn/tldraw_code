// @vitest-environment jsdom
import { type Envelope, encodeEnvelope, makeEvent, parseEnvelope } from '@tldraw-code/protocol'
import { createShapeId, type Editor } from 'tldraw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type WebSocket as ServerSocket, WebSocketServer } from 'ws'
import { QUESTION_CARD_TYPE } from '../src/ask/QuestionCardShapeUtil'
import { connectBridge } from '../src/bridge/connectBridge'
import { createTestEditor } from './createTestEditor'

// Same real-socket approach as BridgeClient.test.ts: connectBridge is the
// imperative wiring a board script needs (no React), so it is exercised the
// same way a board script's main.js would use it.
let wss: WebSocketServer
let url: string
let received: Envelope[]
let editor: Editor
let stop: (() => void) | undefined

function nextConnection(): Promise<ServerSocket> {
	return new Promise((resolve) => wss.once('connection', resolve))
}

beforeEach(async () => {
	received = []
	wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
	await new Promise<void>((resolve) => wss.once('listening', () => resolve()))
	const address = wss.address()
	if (typeof address !== 'object' || !address) throw new Error('no address')
	url = `ws://127.0.0.1:${address.port}`
	// Attach the collector on 'connection' (not later), so no frame sent right
	// after connecting is ever missed to a race with a listener added later.
	wss.on('connection', (socket) =>
		socket.on('message', (data) => {
			const parsed = parseEnvelope(String(data))
			if (parsed.ok) received.push(parsed.envelope)
		}),
	)
	editor = createTestEditor()
})

afterEach(async () => {
	stop?.()
	stop = undefined
	editor.dispose()
	for (const socket of wss.clients) socket.terminate()
	await new Promise<void>((resolve) => wss.close(() => resolve()))
})

describe('connectBridge', () => {
	it('connects, reports status, and sends a hello event', async () => {
		const statuses: string[] = []
		const connection = nextConnection()
		stop = connectBridge(editor, { url, onStatusChange: (s) => statuses.push(s) })
		await connection
		await expect.poll(() => statuses).toEqual(['connecting', 'connected'])
		await expect
			.poll(() => received)
			.toContainEqual({ v: 1, kind: 'event', name: 'hello', payload: { client: 'canvas' } })
	})

	it('forwards agent.working events, resetting working while not connected', async () => {
		const flags: boolean[] = []
		const connection = nextConnection()
		stop = connectBridge(editor, { url, onAgentWorking: (w) => flags.push(w) })
		const socket = await connection
		socket.send(encodeEnvelope(makeEvent('agent.working', { working: true })))
		// false while 'connecting' (the initial transition), then true from the server's event.
		await expect.poll(() => flags).toEqual([false, true])
	})

	it('resends answers already on the canvas once connected', async () => {
		const id = createShapeId('card1')
		editor.createShape({
			id,
			type: QUESTION_CARD_TYPE,
			props: {
				askId: 'ask-1',
				question: 'Q?',
				options: ['a', 'b'],
				recommendation: 0,
				w: 320,
				h: 160,
				answerKind: 'option',
				answerOption: 1,
				answerText: '',
			},
		})
		const connection = nextConnection()
		stop = connectBridge(editor, { url })
		await connection

		await expect
			.poll(() => received)
			.toContainEqual({
				v: 1,
				kind: 'event',
				name: 'ask.answered',
				payload: { askId: 'ask-1', answer: { kind: 'option', option: 1 } },
			})
	})

	it('stops the client and its watchers when the returned cleanup runs', async () => {
		const connection = nextConnection()
		stop = connectBridge(editor, { url })
		const socket = await connection
		const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
		stop()
		stop = undefined
		await closed
	})
})
