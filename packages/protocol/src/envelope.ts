import { z } from 'zod'

/**
 * Version of the bridge wire protocol. Bump on any breaking change to the
 * envelope shape; both ends reject messages with a different version.
 */
export const PROTOCOL_VERSION = 1 as const

const version = z.literal(PROTOCOL_VERSION)

/** Server -> canvas: ask the canvas to do something. Always answered by a result. */
export const CommandEnvelopeSchema = z.object({
	v: version,
	kind: z.literal('command'),
	id: z.string().min(1),
	name: z.string().min(1),
	payload: z.unknown(),
})

export const BridgeErrorSchema = z.object({
	code: z.string().min(1),
	message: z.string(),
})

/** Canvas -> server: the answer to exactly one command, correlated by `id`. */
export const ResultEnvelopeSchema = z.discriminatedUnion('ok', [
	z.object({
		v: version,
		kind: z.literal('result'),
		id: z.string().min(1),
		ok: z.literal(true),
		payload: z.unknown(),
	}),
	z.object({
		v: version,
		kind: z.literal('result'),
		id: z.string().min(1),
		ok: z.literal(false),
		error: BridgeErrorSchema,
	}),
])

/** Either direction: an unsolicited notification (e.g. `hello`, user answers). */
export const EventEnvelopeSchema = z.object({
	v: version,
	kind: z.literal('event'),
	name: z.string().min(1),
	payload: z.unknown(),
})

export const EnvelopeSchema = z.discriminatedUnion('kind', [
	CommandEnvelopeSchema,
	ResultEnvelopeSchema,
	EventEnvelopeSchema,
])

export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>
export type ResultEnvelope = z.infer<typeof ResultEnvelopeSchema>
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>
export type Envelope = z.infer<typeof EnvelopeSchema>
export type BridgeError = z.infer<typeof BridgeErrorSchema>

export type ParseResult = { ok: true; envelope: Envelope } | { ok: false; error: string }

/** Parse a raw WebSocket frame into a validated envelope. Never throws. */
export function parseEnvelope(raw: string): ParseResult {
	let json: unknown
	try {
		json = JSON.parse(raw)
	} catch {
		return { ok: false, error: 'Frame is not valid JSON' }
	}
	const parsed = EnvelopeSchema.safeParse(json)
	if (!parsed.success) {
		return { ok: false, error: `Invalid envelope: ${parsed.error.message}` }
	}
	return { ok: true, envelope: parsed.data }
}

export function encodeEnvelope(envelope: Envelope): string {
	return JSON.stringify(envelope)
}

export function makeCommand(id: string, name: string, payload: unknown): CommandEnvelope {
	return { v: PROTOCOL_VERSION, kind: 'command', id, name, payload }
}

export function makeOkResult(id: string, payload: unknown): ResultEnvelope {
	return { v: PROTOCOL_VERSION, kind: 'result', id, ok: true, payload }
}

export function makeErrorResult(id: string, error: BridgeError): ResultEnvelope {
	return { v: PROTOCOL_VERSION, kind: 'result', id, ok: false, error }
}

export function makeEvent(name: string, payload: unknown): EventEnvelope {
	return { v: PROTOCOL_VERSION, kind: 'event', name, payload }
}
