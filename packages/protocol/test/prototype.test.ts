import { describe, expect, it } from 'vitest'
import {
	canvasCommands,
	MAX_PROTOTYPE_HTML_LENGTH,
	prototypeIdFromLabel,
	RenderPrototypeSchema,
} from '../src'

const html = '<!doctype html><button>Sign in</button>'

describe('RenderPrototypeSchema', () => {
	it('takes html and a label, and derives the id from the label', () => {
		const parsed = RenderPrototypeSchema.parse({ html, label: 'Login, with tabs!' })
		expect(parsed).toMatchObject({ id: 'login-with-tabs', label: 'Login, with tabs!', html })
	})

	it('keeps an explicit id', () => {
		expect(RenderPrototypeSchema.parse({ html, label: 'Login', id: 'login-v1' }).id).toBe(
			'login-v1',
		)
	})

	it('rejects a missing label or html, oversized html and bad sizes', () => {
		const paths = (input: unknown) =>
			RenderPrototypeSchema.safeParse(input).error?.issues.map((issue) => issue.path.join('.'))
		expect(paths({ label: 'Login' })).toEqual(['html'])
		expect(paths({ html })).toEqual(['label'])
		expect(paths({ html: 'x'.repeat(MAX_PROTOTYPE_HTML_LENGTH + 1), label: 'L' })).toEqual(['html'])
		expect(paths({ html, label: 'L', width: 20, height: 5000 })).toEqual(['width', 'height'])
		expect(paths({ html, label: 'L', id: 'has space' })).toEqual(['id'])
	})

	it('rejects a prototype that iterates on itself', () => {
		const result = RenderPrototypeSchema.safeParse({ html, label: 'Login', iterationOf: 'login' })
		expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['iterationOf'])
	})

	it('is carried by the prototype.render command', () => {
		const payload = canvasCommands['prototype.render'].payload.parse({
			id: 'login-v2',
			label: 'Login v2',
			html,
			iterationOf: 'login',
		})
		expect(payload.iterationOf).toBe('login')
	})
})

describe('prototypeIdFromLabel', () => {
	it('slugs labels and never returns an empty id', () => {
		expect(prototypeIdFromLabel('  Checkout – Step 2 ')).toBe('checkout-step-2')
		expect(prototypeIdFromLabel('Übersicht')).toBe('ubersicht')
		expect(prototypeIdFromLabel('!!!')).toBe('prototype')
		expect(prototypeIdFromLabel('a'.repeat(100))).toHaveLength(64)
	})
})
