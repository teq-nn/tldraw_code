import { z } from 'zod'
import { KEEP_GRILLING_LABEL, MAX_OPTION_LENGTH, MAX_QUESTION_LENGTH } from './ask'
import { DiagramIdSchema, DiagramSpecObject, MAX_COMPARE_ITEMS, MIN_COMPARE_ITEMS } from './diagram'
import { checkNodesAndEdges } from './graph'
import { PrototypeIdSchema, prototypeIdFromLabel, RenderPrototypeShape } from './prototype'

/**
 * `compare` (ADR 0015, ADR 0020): 2 or 3 alternatives side by side and a
 * question card below them asking which to take. The alternatives are all
 * diagrams (a structure or flow) or all HTML prototypes (a UI). Settling a
 * comparison (ADR 0021) marks the chosen alternative and collapses the rest.
 */

export const CompareItemSchema = z.object({
	label: z
		.string()
		.trim()
		.min(1)
		.max(MAX_OPTION_LENGTH)
		.describe('Short name of the alternative, a few words. Its frame title and its answer button.'),
	caption: z
		.string()
		.trim()
		.min(1)
		.max(160)
		.optional()
		.describe('One sentence on what sets this alternative apart. Shown in its frame.'),
	spec: DiagramSpecObject.optional().describe(
		'For a structure or flow: the alternative as a diagram spec {nodes, edges}, like render_diagram. ' +
			'Give spec or html, the same for every item.',
	),
	html: RenderPrototypeShape.html
		.optional()
		.describe(
			'For a UI: the alternative as one self-contained HTML prototype, like render_prototype (all CSS ' +
				'and JS inline, sandboxed, no network). Give spec or html, the same for every item.',
		),
	id: PrototypeIdSchema.optional().describe(
		'Prototype items only: stable prototype id, e.g. to iterate on it later with render_prototype; ' +
			'defaults to "<comparison id>-<slug of the label>".',
	),
	width: RenderPrototypeShape.width.describe(
		'Prototype items only: viewport width in CSS px (default 480).',
	),
	height: RenderPrototypeShape.height.describe(
		'Prototype items only: viewport height in CSS px (default 360).',
	),
})
export type CompareItem = z.infer<typeof CompareItemSchema>

/** Input of `compare`. */
export const CompareShape = {
	id: DiagramIdSchema.describe(
		'Stable id of the comparison, e.g. the id of the decision node it settles. ' +
			'Calling compare again with the same id updates its frames in place.',
	),
	question: z
		.string()
		.trim()
		.min(1)
		.max(MAX_QUESTION_LENGTH)
		.describe('The question, one short sentence, e.g. "Which data flow should we build?"'),
	items: z
		.array(CompareItemSchema)
		.min(MIN_COMPARE_ITEMS)
		.max(MAX_COMPARE_ITEMS)
		.describe('2 or 3 alternatives, shown side by side in this order.'),
	recommendation: z
		.string()
		.trim()
		.min(1)
		.describe('Label of the alternative you recommend; marked on the question card.'),
}

/** What a comparison compares: diagrams (structure, flow) or prototypes (UI). */
export type CompareKind = 'diagram' | 'prototype'

export function compareKind(input: { items: readonly Pick<CompareItem, 'html'>[] }): CompareKind {
	return input.items[0]?.html !== undefined ? 'prototype' : 'diagram'
}

/** The prototype id of a prototype item: its own, else `<comparison id>-<slug of its label>`. */
export function comparePrototypeId(comparisonId: string, item: Pick<CompareItem, 'id' | 'label'>) {
	if (item.id) return item.id
	return `${comparisonId}-${prototypeIdFromLabel(item.label)}`.slice(0, 64).replace(/-+$/, '')
}

export const CompareSchema = z.object(CompareShape).superRefine((input, ctx) => {
	const kind = compareKind(input)
	const seen = new Set<string>()
	const prototypeIds = new Set<string>()
	input.items.forEach((item, index) => {
		const path = ['items', index]
		if ((item.spec === undefined) === (item.html === undefined)) {
			ctx.addIssue({
				code: 'custom',
				path,
				message: 'give exactly one of spec (a diagram) or html (a prototype)',
			})
		} else if ((item.html !== undefined ? 'prototype' : 'diagram') !== kind) {
			ctx.addIssue({
				code: 'custom',
				path,
				message:
					'compare diagrams with diagrams and prototypes with prototypes: all items need spec, or all html',
			})
		}
		if (item.spec) checkNodesAndEdges(item.spec, ctx, [...path, 'spec'])
		if (item.spec) {
			for (const key of ['id', 'width', 'height'] as const) {
				if (item[key] !== undefined) {
					ctx.addIssue({
						code: 'custom',
						path: [...path, key],
						message: `${key} is for prototype items only`,
					})
				}
			}
		}
		if (item.html !== undefined) {
			const id = comparePrototypeId(input.id, item)
			if (prototypeIds.has(id)) {
				ctx.addIssue({
					code: 'custom',
					path: [...path, 'id'],
					message: `two prototypes would get the id '${id}'; give them distinct ids`,
				})
			}
			prototypeIds.add(id)
		}
		const key = item.label.toLowerCase()
		if (seen.has(key) || key === KEEP_GRILLING_LABEL.toLowerCase()) {
			ctx.addIssue({
				code: 'custom',
				path: [...path, 'label'],
				message:
					key === KEEP_GRILLING_LABEL.toLowerCase()
						? `'${KEEP_GRILLING_LABEL}' is added to every question card automatically`
						: `duplicate label '${item.label}'`,
			})
		}
		seen.add(key)
	})
	if (!input.items.some((item) => item.label === input.recommendation)) {
		ctx.addIssue({
			code: 'custom',
			path: ['recommendation'],
			message: `recommendation '${input.recommendation}' is not the label of an item`,
		})
	}
})
export type CompareInput = z.infer<typeof CompareSchema>

/** Longest reason accepted for a rejected alternative. */
export const MAX_CHOICE_REASON_LENGTH = 160

/** Input of `settle_comparison` (ADR 0021). */
export const SettleComparisonShape = {
	id: DiagramIdSchema.describe('Id of the comparison, as given to compare.'),
	chosen: z
		.string()
		.trim()
		.min(1)
		.max(MAX_OPTION_LENGTH)
		.describe('Label of the alternative the user chose.'),
	rejected: z
		.array(
			z.object({
				label: z
					.string()
					.trim()
					.min(1)
					.max(MAX_OPTION_LENGTH)
					.describe('Label of the alternative.'),
				reason: z
					.string()
					.trim()
					.min(1)
					.max(MAX_CHOICE_REASON_LENGTH)
					.describe('Why it was not chosen, one short line, e.g. "Extra hop for every write".'),
			}),
		)
		.min(1)
		.max(MAX_COMPARE_ITEMS - 1)
		.describe('Every other alternative of the comparison, each with the reason it lost.'),
	node: DiagramIdSchema.optional().describe(
		'Id of the decision node the choice settles; the chosen alternative is pinned to it. ' +
			'Defaults to the comparison id.',
	),
}

export const SettleComparisonSchema = z.object(SettleComparisonShape).superRefine((input, ctx) => {
	const labels = new Set([input.chosen.toLowerCase()])
	input.rejected.forEach((entry, index) => {
		const key = entry.label.toLowerCase()
		if (labels.has(key)) {
			ctx.addIssue({
				code: 'custom',
				path: ['rejected', index, 'label'],
				message:
					key === input.chosen.toLowerCase()
						? `'${entry.label}' is the chosen alternative`
						: `'${entry.label}' is listed twice`,
			})
		}
		labels.add(key)
	})
})
export type SettleComparisonInput = z.infer<typeof SettleComparisonSchema>
