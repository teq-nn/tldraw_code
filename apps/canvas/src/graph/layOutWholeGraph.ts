import { Box, type Editor } from 'tldraw'
import { QUESTION_CARD_TYPE } from '../ask/QuestionCardShapeUtil'
import { QUESTION_CARD_SLOT } from '../comparison/arrangement'
import { prototypeComparisonOf } from '../comparison/comparisonFrames'
import { diagramMeta } from '../diagram/renderDiagrams'
import { agentNoteMeta } from '../note/renderNote'
import { PROTOTYPE_FRAME_TYPE } from '../prototype/PrototypeShapeUtil'
import { layoutGraph } from './layout'
import type { PlaceGraph } from './renderGraph'

/**
 * Lay the whole graph out afresh (ADR 0004): at the stored origin, or centred
 * in the viewport when the graph is new, and clear of the rows to its right
 * and of what Claude placed below it. Every node gets a position. A tidy
 * places the graph this way (ADR 0032); a first render does too, then moves
 * the block into free space (`placeInFreeSpace`).
 */
export const layOutWholeGraph: PlaceGraph = (editor, graph) => {
	const layout = layoutGraph(graph.nodes, graph.edges)
	const origin = clearOfPlaced(
		editor,
		clearOfRows(
			editor,
			graph.previousOrigin ?? centredOrigin(editor, layout.width, layout.height),
			layout,
		),
		graph.nodes.map((node) => ({ ...node, ...(layout.positions.get(node.id) ?? { x: 0, y: 0 }) })),
	)
	const positions = new Map(
		[...layout.positions].map(([id, { x, y }]) => [id, { x: origin.x + x, y: origin.y + y }]),
	)
	return { origin, positions }
}

/** Space kept between the graph and the rows of diagrams and prototypes to its right. */
const ROW_GAP = 80

/**
 * Keep a growing graph out of the rows of diagram and prototype frames placed
 * to its right (ADR 0015, ADR 0017): when the graph at `origin` would run into
 * one, it moves left by the overlap, so everything else stays where the user
 * saw it. Frames the graph lies to the right of are left alone. A
 * comparison's frames count with the slot for their question card on the
 * left (ADR 0029).
 */
function clearOfRows(
	editor: Editor,
	origin: { x: number; y: number },
	layout: { width: number; height: number },
): { x: number; y: number } {
	const graph = new Box(origin.x, origin.y, layout.width, layout.height)
	const rows = editor
		.getCurrentPageShapes()
		.filter((shape) => shape.parentId === editor.getCurrentPageId())
		.filter(
			(shape) =>
				shape.type === PROTOTYPE_FRAME_TYPE || diagramMeta(shape.meta)?.diagramPart === 'frame',
		)
		.flatMap((shape) => {
			const bounds = editor.getShapePageBounds(shape.id)
			if (!bounds || bounds.minX <= graph.minX) return []
			const compared =
				diagramMeta(shape.meta)?.diagramKind === 'comparison' || prototypeComparisonOf(shape)
			return compared
				? [
						new Box(
							bounds.x - QUESTION_CARD_SLOT,
							bounds.y,
							bounds.w + QUESTION_CARD_SLOT,
							bounds.h,
						),
					]
				: [bounds]
		})
		.filter((bounds) => Box.Collides(Box.ExpandBy(graph, ROW_GAP), bounds))
	if (rows.length === 0) return origin
	const limit = Math.min(...rows.map((bounds) => bounds.minX)) - ROW_GAP
	return { x: Math.round(Math.min(origin.x, limit - layout.width)), y: origin.y }
}

/** Space kept between the graph's nodes and a card, note or frame below them. */
const PLACED_GAP = 60

/**
 * Keep a graph that grows downward off what Claude placed below it (#26): an
 * open question card, an agent note, a diagram or prototype frame. When a
 * node at `origin` would come within the gap of one, the whole graph moves up
 * above it (arrows included), so the placed shape stays where the user saw
 * it, as the rows to the right do (`clearOfRows`). Shapes at or above the
 * graph's top edge are left to `clearOfRows`: a graph grows right and down.
 * The graph only ever moves up, so a shape it has cleared stays clear.
 */
function clearOfPlaced(
	editor: Editor,
	origin: { x: number; y: number },
	nodes: { x: number; y: number; w: number; h: number }[],
): { x: number; y: number } {
	const placed = editor
		.getCurrentPageShapes()
		.filter((shape) => shape.parentId === editor.getCurrentPageId())
		.filter(
			(shape) =>
				shape.type === QUESTION_CARD_TYPE ||
				shape.type === PROTOTYPE_FRAME_TYPE ||
				agentNoteMeta(shape.meta) !== undefined ||
				diagramMeta(shape.meta)?.diagramPart === 'frame',
		)
		.flatMap((shape) => editor.getShapePageBounds(shape.id) ?? [])
		.filter((bounds) => bounds.minY > origin.y)
		.sort((a, b) => a.minY - b.minY)
	const bottom = Math.max(0, ...nodes.map((node) => node.y + node.h))
	let y = origin.y
	for (const bounds of placed) {
		const reaches = nodes.some((node) =>
			withinGap(new Box(origin.x + node.x, y + node.y, node.w, node.h), bounds, PLACED_GAP),
		)
		if (reaches) y = bounds.minY - PLACED_GAP - bottom
	}
	return { x: origin.x, y: Math.round(y) }
}

/** `a` overlaps `b` or comes closer to it than `gap` on both axes. */
function withinGap(a: Box, b: Box, gap: number): boolean {
	return (
		a.maxX + gap > b.minX && a.minX < b.maxX + gap && a.maxY + gap > b.minY && a.minY < b.maxY + gap
	)
}

/** Place a new graph centred in the current viewport. */
function centredOrigin(editor: Editor, width: number, height: number) {
	const center = editor.getViewportPageBounds().center
	return { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) }
}
