import {
	type CanvasActivity,
	type CommandEnvelope,
	type Envelope,
	encodeEnvelope,
	makeErrorResult,
	makeEvent,
	makeOkResult,
	parseEnvelope,
} from '@tldraw-code/protocol'
import WebSocket from 'ws'

type Handler = (command: CommandEnvelope) => Envelope | undefined

/**
 * Stand-in for the browser canvas tab: connects to the bridge, records every
 * command it receives, and answers according to a swappable handler.
 * `canvas.activity` queries, which the server makes after every tool call,
 * are answered from {@link activity} and counted apart from `commands`.
 */
export class FakeCanvas {
	readonly commands: CommandEnvelope[] = []
	/** What the user "did" since the last read; reported to every activity query. */
	activity: CanvasActivity = { added: {}, changed: 0, removed: 0 }
	activityQueries = 0
	private handler: Handler = (command) => makeOkResult(command.id, { shapeId: 'shape:fake' })

	private constructor(private readonly socket: WebSocket) {
		socket.on('message', (data) => {
			const parsed = parseEnvelope(data.toString())
			if (!parsed.ok || parsed.envelope.kind !== 'command') return
			if (parsed.envelope.name === 'canvas.activity') {
				this.activityQueries++
				socket.send(encodeEnvelope(makeOkResult(parsed.envelope.id, this.activity)))
				return
			}
			this.commands.push(parsed.envelope)
			const reply = this.handler(parsed.envelope)
			if (reply) socket.send(encodeEnvelope(reply))
		})
	}

	static async connect(port: number, origin?: string): Promise<FakeCanvas> {
		const socket = new WebSocket(`ws://127.0.0.1:${port}`, origin ? { origin } : {})
		await new Promise<void>((resolve, reject) => {
			socket.once('open', () => resolve())
			socket.once('error', reject)
			socket.once('unexpected-response', (_req, res) =>
				reject(new Error(`rejected with HTTP ${res.statusCode}`)),
			)
		})
		socket.send(encodeEnvelope(makeEvent('hello', { client: 'canvas' })))
		return new FakeCanvas(socket)
	}

	/** Answer commands with this handler from now on. Return undefined to stay silent. */
	respondWith(handler: Handler): void {
		this.handler = handler
	}

	/** Send an unsolicited event to the server, as the canvas does when the user answers. */
	sendEvent(name: string, payload: unknown): void {
		this.socket.send(encodeEnvelope(makeEvent(name, payload)))
	}

	failWith(code: string, message: string): void {
		this.respondWith((command) => makeErrorResult(command.id, { code, message }))
	}

	/** Resolves once the socket is closed, with the close code. */
	closed(): Promise<number> {
		if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve(1000)
		return new Promise((resolve) => this.socket.once('close', (code) => resolve(code)))
	}

	async close(): Promise<void> {
		const closed = this.closed()
		this.socket.close()
		await closed
	}
}
