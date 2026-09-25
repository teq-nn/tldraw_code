import type { CanvasCommandPayload, CanvasCommandResult } from '@tldraw-code/protocol'
import { Box, type Editor, type TLArrowBinding, type TLShapeId } from 'tldraw'
import { anchorOf } from '../perception/readCanvas'
import { isClaudeShape } from '../perception/shapeRoles'
import { ringOffsets } from './placeInFreeSpace'
import { renderGraph } from './renderGraph'

/** Grid step of the search for a spot where a moved note still annotates its node. */
const STEP = 20
/** How many rings of that grid the search walks out; anchor reach (ADR 0008) bounds it anyway. */
const MAX_RINGS = 20

/**
 * A tidy (issue #29): layout flavour F2's one-shot full re-layout, as
 * FigJam's "Tidy up". The graph is laid out afresh at its stored origin, as
 * the baseline lays it out on every render, and every user shape anchored to
 * a decision node (ADR 0008) moves with that node, so it keeps its anchor:
 * by the node's own move, then as little further as it takes to stay clear of
 * Claude's other shapes, or at least to keep a neighbour of the node from
 * taking the anchor over.
 */
export function tidyGraph(
	editor: Editor,
	payload: CanvasCommandPayload<'graph.render'>,
): CanvasCommandResult<'graph.render'> {
	const followers = anchoredToNodes(editor)
	const before = new Map(
		[...new Set(followers.values())].flatMap((node) => {
			const bounds = editor.getShapePageBounds(node)
			return bounds ? [[node, bounds.point] as const] : []
		}),
	)
	const result = renderGraph(editor, payload)
	editor.run(() => {
		for (const [id, node] of followers) {
			const shape = editor.getShape(id)
			const bounds = editor.getShapePageBounds(id)
			const was = before.get(node)
			const now = editor.getShapePageBounds(node)?.point
			if (!shape || !bounds || !was || !now) continue
			const moved = Box.From(bounds).translate({ x: now.x - was.x, y: now.y - was.y })
			const others = claudeShapesBesides(editor, node)
			const annotates = (box: Box) => anchorOf(editor, shape, box)?.shapeId === node
			const spot =
				nearestSpot(moved, (box) => annotates(box) && others.every((o) => !Box.Collides(box, o))) ??
				nearestSpot(moved, annotates) ??
				moved
			editor.updateShape({
				id,
				type: shape.type,
				x: shape.x + spot.x - bounds.x,
				y: shape.y + spot.y - bounds.y,
			})
		}
	})
	return result
}

/**
 * The user's shapes on the page that annotate a decision node, with that
 * node. Arrows bound to a shape are left out: their ends follow what they are
 * bound to.
 */
function anchoredToNodes(editor: Editor): Map<TLShapeId, TLShapeId> {
	const pageId = editor.getCurrentPageId()
	return new Map(
		editor.getCurrentPageShapes().flatMap((shape) => {
			if (shape.parentId !== pageId || isClaudeShape(shape)) return []
			if (editor.getBindingsFromShape<TLArrowBinding>(shape.id, 'arrow').length > 0) return []
			const anchor = anchorOf(editor, shape)
			return anchor?.role === 'decision_node'
				? [[shape.id, anchor.shapeId as TLShapeId] as const]
				: []
		}),
	)
}

/** Bounds of Claude's shapes on the page but `node`, arrows aside: what a moved note keeps off. */
function claudeShapesBesides(editor: Editor, node: TLShapeId): Box[] {
	const pageId = editor.getCurrentPageId()
	return editor
		.getCurrentPageShapes()
		.filter((shape) => shape.parentId === pageId && shape.id !== node && shape.type !== 'arrow')
		.filter(isClaudeShape)
		.flatMap((shape) => editor.getShapePageBounds(shape.id) ?? [])
}

/** The spot nearest `target` that passes `fits`, walking square rings of the grid outwards. */
function nearestSpot(target: Box, fits: (box: Box) => boolean): Box | undefined {
	for (let ring = 0; ring <= MAX_RINGS; ring++) {
		const spots = ringOffsets(ring)
			.map(([dx, dy]) => ({ dx, dy, distance: Math.hypot(dx, dy) }))
			.sort((a, b) => a.distance - b.distance)
		for (const { dx, dy } of spots) {
			const box = Box.From(target).translate({ x: dx * STEP, y: dy * STEP })
			if (fits(box)) return box
		}
	}
	return undefined
}
