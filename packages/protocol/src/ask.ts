import { z } from 'zod'

/**
 * A question Claude puts to the user through `ask` (ADR 0006). The canvas
 * shows it as a question card: the question, one button per option with
 * Claude's recommendation marked, and a "Keep grilling" button.
 */

export const MAX_QUESTION_LENGTH = 200
export const MAX_OPTION_LENGTH = 60
export const MIN_OPTIONS = 2
export const MAX_OPTIONS = 4

/** Label of the extra button every question card has, for "dig deeper before deciding". */
export const KEEP_GRILLING_LABEL = 'Keep grilling'

/** Structural schema of the `ask` tool input; use {@link QuestionSchema} to validate. */
export const QuestionShape = {
	question: z
		.string()
		.trim()
		.min(1)
		.max(MAX_QUESTION_LENGTH)
		.describe('The question, one short sentence.'),
	options: z
		.array(z.string().trim().min(1).max(MAX_OPTION_LENGTH))
		.min(MIN_OPTIONS)
		.max(MAX_OPTIONS)
		.describe('2 to 4 short answer options, each a few words. Shown as buttons.'),
	recommendation: z
		.string()
		.trim()
		.min(1)
		.describe('Your recommended answer; must be exactly one of the options. Marked on the card.'),
}

/** A complete question: unique options and a recommendation that is one of them. */
export const QuestionSchema = z.object(QuestionShape).superRefine((q, ctx) => {
	const seen = new Set<string>()
	q.options.forEach((option, index) => {
		const key = option.toLowerCase()
		if (seen.has(key) || key === KEEP_GRILLING_LABEL.toLowerCase()) {
			ctx.addIssue({
				code: 'custom',
				path: ['options', index],
				message:
					key === KEEP_GRILLING_LABEL.toLowerCase()
						? `'${KEEP_GRILLING_LABEL}' is added to every card automatically`
						: `duplicate option '${option}'`,
			})
		}
		seen.add(key)
	})
	if (!q.options.includes(q.recommendation)) {
		ctx.addIssue({
			code: 'custom',
			path: ['recommendation'],
			message: `recommendation '${q.recommendation}' is not one of the options`,
		})
	}
})
export type Question = z.infer<typeof QuestionSchema>

/** Id correlating a question card with the `ask` call waiting for it. */
export const AskIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[A-Za-z0-9_-]+$/)

/** What the user did on a question card. */
export const AskAnswerSchema = z.discriminatedUnion('kind', [
	/** Clicked one of the option buttons; `option` is its index in `options`. */
	z.object({
		kind: z.literal('option'),
		option: z
			.number()
			.int()
			.min(0)
			.max(MAX_OPTIONS - 1),
	}),
	/** Clicked "Keep grilling": wants to dig deeper before deciding. */
	z.object({ kind: z.literal('keep_grilling') }),
	/** Stuck a sticky note next to the card; `text` is the note's text. */
	z.object({ kind: z.literal('note'), text: z.string().min(1).max(2000) }),
])
export type AskAnswer = z.infer<typeof AskAnswerSchema>
