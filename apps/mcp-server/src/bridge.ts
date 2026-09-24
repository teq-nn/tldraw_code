import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import {
	type BridgeError,
	BridgeErrorCode,
	type CanvasCommandName,
	type CanvasCommandPayload,
	type CanvasCommandResult,
	canvasCommands,
	type EventEnvelope,
	encodeEnvelope,
	makeCommand,
	parseEnvelope,
} from '@tldraw-code/protocol'
import { type WebSocket, WebSocketServer } from 'ws'

export interface CanvasBridgeOptions {
	/** Port to listen on. 0 picks a free port (useful in tests). */
	port: number
	/** Interface to bind. Defaults to loopback so nothing outside this machine can connect. */
	host?: string
	/** How long to wait for the canvas to answer a command. */
	requestTimeoutMs?: number
	/** Diagnostic logger. Must not write to stdout: stdout carries the MCP stdio transport. */
	log?: (message: string) => void
}

/** Raised by {@link CanvasBridge.request} when the canvas cannot or did not execute a command. */
export class CanvasBridgeError extends Error {
	readonly code: string

	constructor(error: BridgeError) {
		super(error.message)
		this.name = 'CanvasBridgeError'
		this.code = error.code
	}
}

interface PendingRequest {
	name: CanvasCommandName
	resolve: (value: unknown) => void
	reject: (error: CanvasBridgeError) => void
	timer: NodeJS.Timeout
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000

/**
 * WebSocket server that the canvas tab connects to. Exactly one canvas is
 * active at a time: a newly connecting tab replaces the previous one.
 * The MCP tools talk to the canvas only through {@link request}.
 */
export class CanvasBridge {
	private readonly options: Required<CanvasBridgeOptions>
	private wss: WebSocketServer | undefined
	private canvas: WebSocket | undefined
	private startError: string | undefined
	private readonly pending = new Map<string, PendingRequest>()
	private readonly eventListeners = new Set<(event: EventEnvelope) => void>()

	constructor(options: CanvasBridgeOptions) {
		this.options = {
			host: '127.0.0.1',
			requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
			log: () => {},
			...options,
		}
	}

	/** Start listening. Resolves with the bound port. */
	start(): Promise<number> {
		return new Promise((resolve, reject) => {
			const wss = new WebSocketServer({
				host: this.options.host,
				port: this.options.port,
				verifyClient: ({ req }: { req: IncomingMessage }) => isAllowedOrigin(req.headers.origin),
			})
			const onStartError = (error: Error) => {
				this.startError = `the bridge could not listen on port ${this.options.port} (${error.message})`
				reject(error)
			}
			wss.once('error', onStartError)
			wss.once('listening', () => {
				wss.off('error', onStartError)
				wss.on('error', (error) => this.options.log(`bridge error: ${error.message}`))
				const address = wss.address()
				const port = typeof address === 'object' && address ? address.port : this.options.port
				this.options.log(`bridge listening on ws://${this.options.host}:${port}`)
				resolve(port)
			})
			wss.on('connection', (socket) => this.attach(socket))
			this.wss = wss
		})
	}

	async stop(): Promise<void> {
		this.rejectAll({ code: BridgeErrorCode.Disconnected, message: 'Bridge is shutting down' })
		const wss = this.wss
		this.wss = undefined
		this.canvas = undefined
		if (!wss) return
		for (const client of wss.clients) client.terminate()
		await new Promise<void>((resolve) => wss.close(() => resolve()))
	}

	isConnected(): boolean {
		return this.canvas !== undefined
	}

	/** Subscribe to unsolicited canvas events. Returns an unsubscribe function. */
	onEvent(listener: (event: EventEnvelope) => void): () => void {
		this.eventListeners.add(listener)
		return () => this.eventListeners.delete(listener)
	}

	/**
	 * Send a command to the connected canvas and wait for its result.
	 * Rejects with {@link CanvasBridgeError} when no canvas is connected, the
	 * canvas reports a failure, the result is malformed, or it times out.
	 */
	request<N extends CanvasCommandName>(
		name: N,
		payload: CanvasCommandPayload<N>,
	): Promise<CanvasCommandResult<N>> {
		const canvas = this.canvas
		if (!canvas) {
			return Promise.reject(
				new CanvasBridgeError({
					code: BridgeErrorCode.NotConnected,
					message: this.startError
						? `No canvas can connect: ${this.startError}. Is another Claude Code session running this server? Set CANVAS_BRIDGE_PORT to use another port.`
						: 'No canvas is connected. Open the canvas app in a browser (pnpm dev) and try again.',
				}),
			)
		}
		const id = randomUUID()
		return new Promise<CanvasCommandResult<N>>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id)
				reject(
					new CanvasBridgeError({
						code: BridgeErrorCode.Timeout,
						message: `Canvas did not answer '${name}' within ${this.options.requestTimeoutMs} ms`,
					}),
				)
			}, this.options.requestTimeoutMs)
			this.pending.set(id, {
				name,
				resolve: resolve as (value: unknown) => void,
				reject,
				timer,
			})
			canvas.send(encodeEnvelope(makeCommand(id, name, payload)))
		})
	}

	private attach(socket: WebSocket): void {
		const previous = this.canvas
		if (previous) {
			this.options.log('a new canvas tab connected; replacing the previous one')
			this.rejectAll({ code: BridgeErrorCode.Replaced, message: 'A newer canvas tab connected' })
			previous.close(4000, 'replaced')
		}
		this.canvas = socket
		this.options.log('canvas connected')

		socket.on('message', (data) => this.handleFrame(socket, data.toString()))
		socket.on('close', () => {
			if (this.canvas !== socket) return
			this.canvas = undefined
			this.options.log('canvas disconnected')
			this.rejectAll({ code: BridgeErrorCode.Disconnected, message: 'Canvas disconnected' })
		})
	}

	private handleFrame(socket: WebSocket, raw: string): void {
		if (socket !== this.canvas) return
		const parsed = parseEnvelope(raw)
		if (!parsed.ok) {
			this.options.log(`dropping frame: ${parsed.error}`)
			return
		}
		const envelope = parsed.envelope
		switch (envelope.kind) {
			case 'result': {
				const pending = this.pending.get(envelope.id)
				if (!pending) {
					this.options.log(`dropping result for unknown request ${envelope.id}`)
					return
				}
				this.pending.delete(envelope.id)
				clearTimeout(pending.timer)
				if (!envelope.ok) {
					pending.reject(new CanvasBridgeError(envelope.error))
					return
				}
				const result = canvasCommands[pending.name].result.safeParse(envelope.payload)
				if (!result.success) {
					pending.reject(
						new CanvasBridgeError({
							code: BridgeErrorCode.InvalidPayload,
							message: `Canvas returned a malformed result for '${pending.name}': ${result.error.message}`,
						}),
					)
					return
				}
				pending.resolve(result.data)
				return
			}
			case 'event':
				for (const listener of this.eventListeners) listener(envelope)
				return
			case 'command':
				this.options.log(`ignoring command '${envelope.name}' sent by the canvas`)
				return
		}
	}

	private rejectAll(error: BridgeError): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer)
			pending.reject(new CanvasBridgeError(error))
			this.pending.delete(id)
		}
	}
}

/**
 * Only accept browser connections from pages served by this machine, so an
 * arbitrary website cannot drive the bridge. Non-browser clients send no
 * Origin header and are allowed (they already run locally).
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
	if (!origin) return true
	try {
		const { hostname } = new URL(origin)
		return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
	} catch {
		return false
	}
}
