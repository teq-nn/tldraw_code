import { describe, expect, it } from 'vitest'
import {
	CanvasActivitySchema,
	CanvasRegionSchema,
	canvasCommands,
	isActivityEmpty,
	mentionsAgent,
} from '../src'

describe('CanvasRegionSchema', () => {
	it.each(['all', 'viewport', 'question', { x: -10, y: 0, w: 100, h: 50 }])(
		'accepts %j',
		(region) => {
			expect(CanvasRegionSchema.safeParse(region).success).toBe(true)
		},
	)

	it.each(['everything', { x: 0, y: 0, w: 0, h: 10 }, { x: 0, y: 0, w: 10 }])(
		'rejects %j',
		(region) => {
			expect(CanvasRegionSchema.safeParse(region).success).toBe(false)
		},
	)
})

describe('canvas activity', () => {
	it('counts added shapes by role', () => {
		expect(
			CanvasActivitySchema.safeParse({ added: { sticky_note: 2 }, changed: 0, removed: 0 }).success,
		).toBe(true)
		expect(
			CanvasActivitySchema.safeParse({ added: { unicorn: 1 }, changed: 0, removed: 0 }).success,
		).toBe(false)
	})

	it('knows when nothing happened', () => {
		expect(isActivityEmpty({ added: {}, changed: 0, removed: 0 })).toBe(true)
		expect(isActivityEmpty({ added: { drawing: 1 }, changed: 0, removed: 0 })).toBe(false)
		expect(isActivityEmpty({ added: {}, changed: 0, removed: 1 })).toBe(false)
	})
})

describe('canvas.read result', () => {
	it('allows an empty page', () => {
		const empty = { region: null, shapes: [], omitted: 0, screenshot: null }
		expect(canvasCommands['canvas.read'].result.safeParse(empty).success).toBe(true)
	})
})

describe('mentionsAgent', () => {
	it.each(['&agent', 'Look at this &agent', 'a\n&Agent, please', '(&AGENT)'])(
		'finds the tag in %j',
		(text) => {
			expect(mentionsAgent(text)).toBe(true)
		},
	)

	it.each(['agent', '&agentic', 'me&agent', '&&agent', 'a & agent'])('ignores %j', (text) => {
		expect(mentionsAgent(text)).toBe(false)
	})
})
