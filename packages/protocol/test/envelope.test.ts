import { describe, expect, it } from 'vitest'
import {
	encodeEnvelope,
	makeCommand,
	makeErrorResult,
	makeEvent,
	makeOkResult,
	parseEnvelope,
} from '../src'

describe('parseEnvelope', () => {
	it('round-trips every envelope kind', () => {
		const envelopes = [
			makeCommand('1', 'smoke.create_shape', { text: 'hi' }),
			makeOkResult('1', { shapeId: 'shape:a' }),
			makeErrorResult('1', { code: 'timeout', message: 'too slow' }),
			makeEvent('hello', { client: 'canvas' }),
		]
		for (const envelope of envelopes) {
			expect(parseEnvelope(encodeEnvelope(envelope))).toEqual({ ok: true, envelope })
		}
	})

	it('rejects non-JSON frames', () => {
		expect(parseEnvelope('not json')).toMatchObject({ ok: false })
	})

	it('rejects frames with another protocol version', () => {
		const frame = JSON.stringify({ ...makeEvent('hello', {}), v: 2 })
		expect(parseEnvelope(frame)).toMatchObject({ ok: false })
	})

	it('rejects a failed result without an error', () => {
		const frame = JSON.stringify({ v: 1, kind: 'result', id: '1', ok: false })
		expect(parseEnvelope(frame)).toMatchObject({ ok: false })
	})
})
