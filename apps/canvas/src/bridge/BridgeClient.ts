import {
	BridgeErrorCode,
	type CanvasCommandName,
	type CanvasCommandPayload,
	type CanvasCommandResult,
	type CommandEnvelope,
	canvasCommands,
	encodeEnvelope,
	isCanvasCommandName,
	makeErrorResult,
	makeEvent,
	makeOkResult,
	parseEnvelope,
} from '@tldraw-code/protocol'

export type BridgeStatus = 'connecting' | 'connected' | 'disconnected'

/** One handler per command in the protocol catalog; the compiler enforces completeness. */
export type CommandHandlers = {
	[N in CanvasCommandName]: (
		payload: CanvasCommandPayload<N>,
	) => CanvasCommandResult<N> | Promise<CanvasCommandResult<N>>
}

export interface BridgeClientOptions {
	url: string
	handlers: CommandHandlers
	onStatusChange?: (status: BridgeStatus) => void
	/** Injectable for tests; defaults to the global WebSocket. */
	WebSocketImpl?: typeof WebSocket
	/** First reconnect delay; doubles up to {@link maxReconnectDelayMs}. */
	reconnectDelayMs?: number
	maxReconnectDelayMs?: number
}

/**
 * Canvas side of the bridge: keeps a WebSocket to the MCP server open
 * (reconnecting with backoff, since the server starts and stops with Claude
 * Code sessions), executes incoming commands and answers each with a result.
 */
export class BridgeClient {
	private socket: WebSocket | undefined
	private status: BridgeStatus = 'disconnected'
	private stopped = true
	private reconnectTimer: ReturnType<typeof setTimeout> | undefined
	private reconnectDelay: number
	private readonly WebSocketImpl: typeof WebSocket
	private readonly minDelay: number
	private readonly maxDelay: number

	constructor(private readonly options: BridgeClientOptions) {
		this.WebSocketImpl = options.WebSocketImpl ?? globalThis.WebSocket
		this.minDelay = options.reconnectDelayMs ?? 500
		this.maxDelay = options.maxReconnectDelayMs ?? 5_000
		this.reconnectDelay = this.minDelay
	}

	start(): void {
		if (!this.stopped) return
		this.stopped = false
		this.connect()
	}

	stop(): void {
		this.stopped = true
		clearTimeout(this.reconnectTimer)
		this.socket?.close()
		this.socket = undefined
		this.setStatus('disconnected')
	}

	getStatus(): BridgeStatus {
		return this.status
	}

	private connect(): void {
		this.setStatus('connecting')
		const socket = new this.WebSocketImpl(this.options.url)
		this.socket = socket

		socket.addEventListener('open', () => {
			this.reconnectDelay = this.minDelay
			socket.send(encodeEnvelope(makeEvent('hello', { client: 'canvas' })))
			this.setStatus('connected')
		})
		socket.addEventListener('message', (event) => {
			void this.handleFrame(socket, String(event.data))
		})
		socket.addEventListener('close', () => {
			if (this.socket !== socket) return
			this.socket = undefined
			if (this.stopped) return
			this.setStatus('disconnected')
			this.scheduleReconnect()
		})
	}

	private scheduleReconnect(): void {
		clearTimeout(this.reconnectTimer)
		this.reconnectTimer = setTimeout(() => {
			if (!this.stopped) this.connect()
		}, this.reconnectDelay)
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxDelay)
	}

	private async handleFrame(socket: WebSocket, raw: string): Promise<void> {
		const parsed = parseEnvelope(raw)
		if (!parsed.ok) {
			console.warn('[bridge] dropping frame:', parsed.error)
			return
		}
		if (parsed.envelope.kind !== 'command') return
		const reply = await this.execute(parsed.envelope)
		if (socket.readyState === socket.OPEN) socket.send(encodeEnvelope(reply))
	}

	private async execute(command: CommandEnvelope) {
		const { id, name } = command
		if (!isCanvasCommandName(name)) {
			return makeErrorResult(id, {
				code: BridgeErrorCode.UnknownCommand,
				message: `Canvas does not know command '${name}'`,
			})
		}
		const payload = canvasCommands[name].payload.safeParse(command.payload)
		if (!payload.success) {
			return makeErrorResult(id, {
				code: BridgeErrorCode.InvalidPayload,
				message: payload.error.message,
			})
		}
		try {
			const handler = this.options.handlers[name] as (p: unknown) => unknown
			return makeOkResult(id, await handler(payload.data))
		} catch (error) {
			return makeErrorResult(id, {
				code: BridgeErrorCode.HandlerFailed,
				message: error instanceof Error ? error.message : String(error),
			})
		}
	}

	private setStatus(status: BridgeStatus): void {
		if (this.status === status) return
		this.status = status
		this.options.onStatusChange?.(status)
	}
}
