import {
	type CanvasCommandPayload,
	type CanvasCommandResult,
	DEFAULT_PROTOTYPE_HEIGHT,
	DEFAULT_PROTOTYPE_WIDTH,
	MAX_COMPARE_ITEMS,
} from '@tldraw-code/protocol'
import { Box, createShapeId, type Editor, type TLShapeId } from 'tldraw'
import { gridColumns, QUESTION_CARD_SLOT } from '../comparison/arrangement'
import {
	type ComparisonFrame,
	choiceOf,
	getComparisonFrames,
	type PrototypeComparisonMeta,
	UNSETTLED,
	unpinComparison,
} from '../comparison/comparisonFrames'
import {
	isPrototypeFrame,
	PROTOTYPE_FRAME_TYPE,
	PROTOTYPE_HEADER_HEIGHT,
	type PrototypeFrameShape,
	viewportOf,
} from './PrototypeShapeUtil'

type RenderPayload = CanvasCommandPayload<'prototype.render'>
type RenderResult = CanvasCommandResult<'prototype.render'>

/** Space between an iteration and the shapes to its left, and between the page content and a new prototype. */
export const PROTOTYPE_GAP = 80
const CONTENT_GAP = 160
const VIEW_INSET = 64
/** How many shapes an iteration slides past before it stops looking for free space. */
const MAX_PLACEMENT_STEPS = 50

export function prototypeShapeId(id: string): TLShapeId {
	return createShapeId(`prototype:${id}`)
}

export function getPrototypeFrames(editor: Editor): PrototypeFrameShape[] {
	return editor.getCurrentPageShapes().filter(isPrototypeFrame)
}

/**
 * Show a prototype in a prototype frame, or replace the HTML of the one with
 * the same id in place (ADR 0017). A new iteration (`iterationOf`) goes right
 * next to the prototype it iterates on, top-aligned with it, sliding further
 * right past anything in the way (such as the user's notes sticking out of
 * it); any other new prototype goes to the right of the page content. The
 * size is the one given, else the current one, else the default. One undo step.
 */
export function renderPrototype(editor: Editor, payload: RenderPayload): RenderResult {
	const shapeId = prototypeShapeId(payload.id)
	const existing = editor.getShape(shapeId)
	if (existing && !isPrototypeFrame(existing)) {
		throw new Error(`Shape ${shapeId} is not a prototype frame.`)
	}
	const source = payload.iterationOf
		? editor.getShape(prototypeShapeId(payload.iterationOf))
		: undefined
	if (payload.iterationOf && !isPrototypeFrame(source)) {
		const known = getPrototypeFrames(editor).map((frame) => `"${frame.props.prototypeId}"`)
		throw new Error(
			`There is no prototype "${payload.iterationOf}" on the canvas to iterate on` +
				(known.length > 0 ? `; prototypes on the canvas: ${known.join(', ')}.` : '.'),
		)
	}

	// A collapsed (rejected) alternative shown again gets its full size back (ADR 0021).
	const settled = existing ? choiceOf(existing) : undefined
	const current = existing
		? viewportOf(
				settled?.choice === 'rejected'
					? { ...existing, props: { ...existing.props, h: settled.expandedH } }
					: existing,
			)
		: undefined
	const width = payload.width ?? current?.width ?? DEFAULT_PROTOTYPE_WIDTH
	const height = payload.height ?? current?.height ?? DEFAULT_PROTOTYPE_HEIGHT
	const props = {
		prototypeId: payload.id,
		label: payload.label,
		caption: payload.caption ?? '',
		html: payload.html,
		iterationOf: payload.iterationOf ?? '',
		w: width,
		h: height + PROTOTYPE_HEADER_HEIGHT,
	}

	const comparison: PrototypeComparisonMeta | undefined = payload.comparison && {
		comparisonId: payload.comparison.id,
		comparisonIndex: payload.comparison.index,
	}
	// Rendering resets any earlier choice on this prototype; a comparison shown again is open again.
	const meta = { ...UNSETTLED, ...(comparison ?? {}) }

	editor.run(() => {
		if (comparison) unpinComparison(editor, comparison.comparisonId)
		if (existing) {
			editor.updateShape<PrototypeFrameShape>({
				id: shapeId,
				type: PROTOTYPE_FRAME_TYPE,
				opacity: 1,
				props,
				meta,
			})
			return
		}
		const size = { w: props.w, h: props.h }
		const position = payload.comparison
			? alternativePosition(editor, payload.comparison, size)
			: isPrototypeFrame(source)
				? besideSource(editor, source, size)
				: newOrigin(editor, size)
		editor.createShape<PrototypeFrameShape>({
			id: shapeId,
			type: PROTOTYPE_FRAME_TYPE,
			x: position.x,
			y: position.y,
			props,
			meta,
		})
	})

	const bounds = editor.getShapePageBounds(shapeId)
	if (!existing && bounds && !editor.getViewportPageBounds().contains(bounds)) {
		editor.zoomToBounds(Box.ExpandBy(bounds, VIEW_INSET), {
			targetZoom: Math.min(1, editor.getZoomLevel()),
		})
	}
	return {
		shapeId,
		created: !existing,
		bounds: {
			x: Math.round(bounds?.x ?? 0),
			y: Math.round(bounds?.y ?? 0),
			w: Math.max(1, Math.round(bounds?.w ?? props.w)),
			h: Math.max(1, Math.round(bounds?.h ?? props.h)),
		},
		width,
		height,
		...(isPrototypeFrame(source) ? { iterationOfShapeId: source.id } : {}),
	}
}

/**
 * Where a new alternative of a comparison goes (ADR 0029): the alternatives
 * fill a compact grid, sized from the first one, whose columns
 * {@link gridColumns} picks. The first goes right of the page content with
 * the question card's slot kept free on its left; one that starts a row goes
 * below the rows before, aligned with the first; any other right of the
 * alternative before it.
 */
function alternativePosition(
	editor: Editor,
	comparison: NonNullable<RenderPayload['comparison']>,
	size: { w: number; h: number },
) {
	const earlier = getComparisonFrames(editor, comparison.id)
		.filter((frame) => frame.index < comparison.index && isPrototypeFrame(frame.shape))
		.flatMap((frame) => {
			const bounds = editor.getShapePageBounds(frame.shape.id)
			return bounds ? [{ ...frame, bounds }] : []
		})
	const first = earlier[0]
	if (!first) return newOrigin(editor, size, QUESTION_CARD_SLOT)
	const count = comparison.count ?? MAX_COMPARE_ITEMS
	const columns = gridColumns(count, first.bounds, PROTOTYPE_GAP, QUESTION_CARD_SLOT)
	const rowOf = (frame: Pick<ComparisonFrame, 'index'>) => Math.floor(frame.index / columns)
	if (comparison.index % columns === 0) {
		const above = earlier.filter((frame) => rowOf(frame) < rowOf(comparison))
		const bottom = Math.max(first.bounds.maxY, ...above.map((frame) => frame.bounds.maxY))
		return { x: Math.round(first.bounds.minX), y: Math.round(bottom + PROTOTYPE_GAP) }
	}
	const previous = earlier.at(-1)?.shape
	return isPrototypeFrame(previous) ? besideSource(editor, previous, size) : newOrigin(editor, size)
}

/** Right of the source prototype, top-aligned, past every top-level shape in the way. */
function besideSource(editor: Editor, source: PrototypeFrameShape, size: { w: number; h: number }) {
	const sourceBounds = editor.getShapePageBounds(source.id)
	const candidate = new Box(
		Math.round((sourceBounds?.maxX ?? source.x) + PROTOTYPE_GAP),
		Math.round(sourceBounds?.minY ?? source.y),
		size.w,
		size.h,
	)
	const obstacles = editor
		.getCurrentPageShapes()
		.filter((shape) => shape.parentId === editor.getCurrentPageId() && shape.id !== source.id)
		.flatMap((shape) => {
			const bounds = editor.getShapePageBounds(shape.id)
			return bounds ? [bounds] : []
		})
	for (let step = 0; step < MAX_PLACEMENT_STEPS; step++) {
		const padded = Box.ExpandBy(candidate, PROTOTYPE_GAP / 2)
		const blocking = obstacles.filter((bounds) => Box.Collides(padded, bounds))
		if (blocking.length === 0) break
		candidate.x = Math.round(Math.max(...blocking.map((bounds) => bounds.maxX)) + PROTOTYPE_GAP)
	}
	return { x: candidate.x, y: candidate.y }
}

/**
 * Right of everything on the page, top-aligned with it, `reserved` further
 * right to keep a slot free on the left; on an empty page, centred in the
 * viewport together with that slot.
 */
function newOrigin(editor: Editor, size: { w: number; h: number }, reserved = 0) {
	const content = editor.getCurrentPageBounds()
	if (content) {
		return { x: Math.round(content.maxX + CONTENT_GAP + reserved), y: Math.round(content.minY) }
	}
	const center = editor.getViewportPageBounds().center
	return {
		x: Math.round(center.x - (size.w + reserved) / 2 + reserved),
		y: Math.round(center.y - size.h / 2),
	}
}
