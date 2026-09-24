import { z } from 'zod'
import { DiagramIdSchema } from './diagram'

/**
 * HTML prototypes Claude shows with `render_prototype` (ADR 0016, ADR 0017):
 * one self-contained HTML document per prototype frame, displayed in a
 * sandboxed iframe on the canvas. The canvas owns the sandbox; the server
 * only validates and forwards.
 */

/** Longest accepted prototype document, in characters. Everything must be inline. */
export const MAX_PROTOTYPE_HTML_LENGTH = 200_000
export const DEFAULT_PROTOTYPE_WIDTH = 480
export const DEFAULT_PROTOTYPE_HEIGHT = 360
export const MIN_PROTOTYPE_SIZE = 160
export const MAX_PROTOTYPE_WIDTH = 1600
export const MAX_PROTOTYPE_HEIGHT = 1200

/** Stable key of a prototype; the same alphabet as diagram ids. */
export const PrototypeIdSchema = DiagramIdSchema

/** The id a prototype gets when Claude gives none: a slug of its label. */
export function prototypeIdFromLabel(label: string): string {
	const slug = label
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64)
		.replace(/-+$/, '')
	return slug || 'prototype'
}

/** Input of `render_prototype`. */
export const RenderPrototypeShape = {
	label: z
		.string()
		.trim()
		.min(1)
		.max(60)
		.describe('Short name of the prototype, a few words, e.g. "Login, tabs". Shown on its frame.'),
	html: z
		.string()
		.min(1)
		.max(MAX_PROTOTYPE_HTML_LENGTH)
		.describe(
			'One self-contained HTML document: all CSS and JS inline, images as data: URLs. ' +
				'It runs sandboxed without network access, storage, cookies, pop-ups or dialogs; ' +
				"external URLs do not load. Inline the repo's own styles (CSS variables, component classes) " +
				'so it looks like the real app. Keep state in memory.',
		),
	id: PrototypeIdSchema.optional().describe(
		'Stable id; defaults to a slug of the label. Rendering again with the same id replaces its HTML in place.',
	),
	caption: z
		.string()
		.trim()
		.min(1)
		.max(160)
		.optional()
		.describe('One sentence on what sets this prototype apart. Shown on its frame.'),
	iterationOf: PrototypeIdSchema.optional().describe(
		'Id of the prototype this one is a new iteration of (e.g. after feedback drawn on it). ' +
			'A new prototype is then placed right next to that one, which stays as it is.',
	),
	width: z
		.number()
		.int()
		.min(MIN_PROTOTYPE_SIZE)
		.max(MAX_PROTOTYPE_WIDTH)
		.optional()
		.describe(
			`Viewport width in CSS px (default ${DEFAULT_PROTOTYPE_WIDTH}, or the current size when updating).`,
		),
	height: z
		.number()
		.int()
		.min(MIN_PROTOTYPE_SIZE)
		.max(MAX_PROTOTYPE_HEIGHT)
		.optional()
		.describe(
			`Viewport height in CSS px (default ${DEFAULT_PROTOTYPE_HEIGHT}, or the current size when updating).`,
		),
}

export const RenderPrototypeSchema = z
	.object(RenderPrototypeShape)
	.transform((input) => ({ ...input, id: input.id ?? prototypeIdFromLabel(input.label) }))
	.superRefine((input, ctx) => {
		if (input.iterationOf === input.id) {
			ctx.addIssue({
				code: 'custom',
				path: ['iterationOf'],
				message: `a prototype cannot be an iteration of itself ('${input.id}'); give the new iteration its own id or label`,
			})
		}
	})
export type RenderPrototypeInput = z.infer<typeof RenderPrototypeSchema>
