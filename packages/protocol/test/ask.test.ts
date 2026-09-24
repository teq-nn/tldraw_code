import { describe, expect, it } from 'vitest'
import { AskAnswerSchema, QuestionSchema } from '../src'

const valid = {
	question: 'Which storage engine?',
	options: ['SQLite', 'Postgres'],
	recommendation: 'SQLite',
}

function messages(input: unknown): string {
	const parsed = QuestionSchema.safeParse(input)
	return parsed.success ? '' : parsed.error.issues.map((i) => i.message).join('; ')
}

describe('QuestionSchema', () => {
	it('accepts a question with 2 to 4 options and a recommendation among them', () => {
		expect(QuestionSchema.safeParse(valid).success).toBe(true)
		expect(QuestionSchema.safeParse({ ...valid, options: ['A', 'B', 'C', 'SQLite'] }).success).toBe(
			true,
		)
	})

	it('trims whitespace', () => {
		const parsed = QuestionSchema.parse({ ...valid, options: [' SQLite ', 'Postgres'] })
		expect(parsed.options).toEqual(['SQLite', 'Postgres'])
	})

	it.each([
		['one option', { ...valid, options: ['SQLite'] }],
		['five options', { ...valid, options: ['SQLite', 'B', 'C', 'D', 'E'] }],
		['an empty question', { ...valid, question: ' ' }],
		['a very long question', { ...valid, question: 'x'.repeat(201) }],
	])('rejects %s', (_name, input) => {
		expect(QuestionSchema.safeParse(input).success).toBe(false)
	})

	it('rejects a recommendation that is not an option', () => {
		expect(messages({ ...valid, recommendation: 'MySQL' })).toContain('not one of the options')
	})

	it('rejects duplicate options, ignoring case', () => {
		expect(messages({ ...valid, options: ['SQLite', 'sqlite'] })).toContain('duplicate option')
	})

	it('rejects the reserved "Keep grilling" option', () => {
		expect(messages({ ...valid, options: ['SQLite', 'Keep grilling'] })).toContain(
			'added to every card',
		)
	})
})

describe('AskAnswerSchema', () => {
	it('accepts the three kinds of answer', () => {
		for (const answer of [
			{ kind: 'option', option: 1 },
			{ kind: 'keep_grilling' },
			{ kind: 'note', text: 'Neither, use files' },
		]) {
			expect(AskAnswerSchema.safeParse(answer).success).toBe(true)
		}
	})

	it('rejects an empty note', () => {
		expect(AskAnswerSchema.safeParse({ kind: 'note', text: '' }).success).toBe(false)
	})
})
