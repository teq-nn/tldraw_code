import { z } from 'zod'
import { DecisionStatusSchema } from './graph'

/**
 * Canvas perception (ADR 0008, ADR 0009): what `read_canvas` sees, and the
 * activity digest that tells Claude the user changed something.
 */

/** A rectangle in page coordinates (tldraw page units). */
export const PageBoxSchema = z.object({
	x: z.number().finite(),
	y: z.number().finite(),
	w: z.number().finite().positive(),
	h: z.number().finite().positive(),
})
export type PageBox = z.infer<typeof PageBoxSchema>

/**
 * Which part of the canvas to read:
 * - `all`: everything on the page (default);
 * - `viewport`: what the user currently sees;
 * - `question`: the question card and its surroundings, where note answers
 *   and sketches next to the card live;
 * - a page box `{ x, y, w, h }`, e.g. around a shape from an earlier read.
 */
export const CanvasRegionSchema = z.union([z.enum(['all', 'viewport', 'question']), PageBoxSchema])
export type CanvasRegion = z.infer<typeof CanvasRegionSchema>

/** Who put a shape on the canvas: Claude (through a canvas tool) or the user. */
export const ShapeOwnerSchema = z.enum(['claude', 'user'])

/**
 * What a shape means in the session. Claude's shapes have domain roles; the
 * user's shapes are named by what they look like.
 */
export const ShapeRoleSchema = z.enum([
	'decision_node',
	'dependency',
	'question_card',
	'diagram_frame',
	'diagram_node',
	'diagram_edge',
	'prototype_frame',
	'choice_pin',
	'sticky_note',
	'drawing',
	'text',
	'geo',
	'arrow',
	'line',
	'frame',
	'image',
	'other',
])
export type ShapeRole = z.infer<typeof ShapeRoleSchema>

/** A Claude-owned shape that a user shape lies on or next to. */
export const ShapeAnchorSchema = z.object({
	shapeId: z.string(),
	role: ShapeRoleSchema,
	/** `on`: the bounds overlap; `next_to`: within reach but not overlapping. */
	relation: z.enum(['on', 'next_to']),
	/** Short name of the anchor, e.g. the decision's title or the question. */
	label: z.string(),
	/**
	 * Prototype frame anchors (ADR 0017): the part of the annotation that lies
	 * over the prototype's viewport, in the prototype's own CSS pixels
	 * (origin at its top-left corner), to match against its HTML layout.
	 */
	inPrototype: z
		.object({
			x: z.number(),
			y: z.number(),
			w: z.number().nonnegative(),
			h: z.number().nonnegative(),
		})
		.optional(),
})
export type ShapeAnchor = z.infer<typeof ShapeAnchorSchema>

/** One shape as `read_canvas` reports it. Bounds are page bounds, rounded. */
export const CanvasShapeSchema = z.object({
	id: z.string(),
	/** tldraw shape type, e.g. `note`, `draw`, `geo`, `question-card`. */
	type: z.string(),
	role: ShapeRoleSchema,
	owner: ShapeOwnerSchema,
	bounds: PageBoxSchema.extend({ w: z.number().nonnegative(), h: z.number().nonnegative() }),
	/** Plain text of the shape (label, note text, question), if any. */
	text: z.string().optional(),
	/** tldraw colour style, if the shape has one. */
	color: z.string().optional(),
	/** Geo kind (rectangle, ellipse, ...) of a `geo` shape. */
	geo: z.string().optional(),
	/** Decision node id (`decision_node`) or edge key `from->to` (`dependency`). */
	decisionId: z.string().optional(),
	/** Decision status, derived from the node's colour. */
	status: DecisionStatusSchema.optional(),
	onFrontier: z.boolean().optional(),
	/** Question card: options, recommended index, and the answer if given. */
	question: z
		.object({
			options: z.array(z.string()),
			recommendation: z.number().int(),
			answer: z.string().optional(),
		})
		.optional(),
	/**
	 * Diagram shapes (`render_diagram`, `compare`, ADR 0014, ADR 0015): which diagram or
	 * comparison they belong to, the frame's title (for a comparison, the
	 * alternative's label), the node id or edge key, and whether the element
	 * is highlighted as a difference between the alternatives.
	 */
	diagram: z
		.object({
			kind: z.enum(['diagram', 'comparison']),
			id: z.string(),
			frame: z.string(),
			element: z.string().optional(),
			differs: z.boolean().optional(),
		})
		.optional(),
	/** Prototype frame (`render_prototype`, ADR 0017): its id, label, and what it iterates on. */
	prototype: z
		.object({
			id: z.string(),
			label: z.string(),
			iterationOf: z.string().optional(),
			/** Viewport size in CSS px. */
			width: z.number(),
			height: z.number(),
			/** Id of the comparison it is an alternative of (`compare`, ADR 0020). */
			comparison: z.string().optional(),
		})
		.optional(),
	/**
	 * An alternative of a settled comparison (ADR 0021): chosen, or rejected
	 * (collapsed to its title bar) with the reason it lost.
	 */
	choice: z
		.object({
			state: z.enum(['chosen', 'rejected']),
			reason: z.string().optional(),
		})
		.optional(),
	/** Arrow / dependency: ids of the shapes its ends are bound to. */
	fromShapeId: z.string().optional(),
	toShapeId: z.string().optional(),
	/** Id of the frame the shape sits in, if any. */
	frameId: z.string().optional(),
	/** User shapes: the Claude-owned shape they annotate (overlap or proximity). */
	anchor: ShapeAnchorSchema.optional(),
})
export type CanvasShape = z.infer<typeof CanvasShapeSchema>

/** Bitmap of the read region, base64-encoded. */
export const CanvasScreenshotSchema = z.object({
	mimeType: z.enum(['image/png', 'image/jpeg']),
	data: z.string().min(1),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
})
export type CanvasScreenshot = z.infer<typeof CanvasScreenshotSchema>

/**
 * User activity on the canvas since the last `read_canvas` (ADR 0009).
 * Changes Claude's own tools made are not counted.
 */
export const CanvasActivitySchema = z.object({
	/** Shapes the user added, counted by role. */
	added: z.partialRecord(ShapeRoleSchema, z.number().int().positive()),
	/** Existing shapes the user moved or edited (not counting added ones). */
	changed: z.number().int().nonnegative(),
	/** Shapes the user deleted (not counting ones added and deleted again). */
	removed: z.number().int().nonnegative(),
})
export type CanvasActivity = z.infer<typeof CanvasActivitySchema>

/** Longest edge of a screenshot in pixels; larger regions are scaled down. */
export const MAX_SCREENSHOT_EDGE = 1568
/** Most shapes one read lists; the rest are counted in `omitted`. */
export const MAX_READ_SHAPES = 150

export function isActivityEmpty(activity: CanvasActivity): boolean {
	return (
		Object.keys(activity.added).length === 0 && activity.changed === 0 && activity.removed === 0
	)
}
