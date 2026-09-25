import { Box, type Editor, type TLShapeId } from 'tldraw'
import { ANCHOR_REACH } from '../perception/readCanvas'
import { isClaudeShape } from '../perception/shapeRoles'
import { layOutWholeGraph } from './layOutWholeGraph'
import { GRAPH_LAYOUT_STYLE, type LayoutNode } from './layout'
import { type GraphPlacement, type GraphToPlace, nodeShapeId, type PlaceGraph } from './renderGraph'

/** Gap between a new node and Claude's shapes: the layout's own gap between nodes in a rank. */
const CLAUDE_CLEARANCE = GRAPH_LAYOUT_STYLE.nodesep
/**
 * Gap between a new node and the user's shapes: beyond anchor reach (ADR 0008),
 * so a new node never takes over a note that annotates another shape.
 */
const USER_CLEARANCE = ANCHOR_REACH + 1
/** Distance from a node's blockers to its rank slot: the layout's gap between ranks. */
const RANK_GAP = GRAPH_LAYOUT_STYLE.ranksep
/** Grid step of the search for free space. */
const STEP = 20
/** How far up or down its rank column a node may go before it looks anywhere near instead. */
const COLUMN_REACH = 30 * STEP
/** How many rings of the grid the search for the nearest free spot walks out. */
const MAX_RINGS = 150

interface Obstacle {
	bounds: Box
	clearance: number
}

/**
 * The placement of every render but a tidy (ADR 0032, issue #28): the canvas
 * is user-owned space, so a node, once placed, is never moved again, wherever
 * the user dragged it. A new node goes into free space in the rank slot right
 * of its blockers, higher or lower in that column when the slot is taken,
 * else in the nearest free spot. A node that left the graph leaves its gap.
 * A new graph is laid out whole, in free space.
 */
export const placeInFreeSpace: PlaceGraph = (editor, graph) => {
	const placed = new Map<string, Box>()
	for (const node of graph.nodes) {
		if (!graph.drawn.has(node.id)) continue
		const bounds = editor.getShapePageBounds(nodeShapeId(node.id))
		if (bounds) placed.set(node.id, bounds)
	}
	const newNodes = graph.nodes.filter((node) => !placed.has(node.id))
	const obstacles = obstaclesOnPage(editor, new Set(newNodes.map((node) => nodeShapeId(node.id))))
	if (placed.size === 0) return layOutWholeGraphInFreeSpace(editor, graph, obstacles)

	const positions = new Map<string, { x: number; y: number }>()
	for (const node of blockersFirst(newNodes, graph)) {
		const box = findSpot(node, graph, placed, obstacles)
		placed.set(node.id, box)
		obstacles.push({ bounds: box, clearance: CLAUDE_CLEARANCE })
		positions.set(node.id, { x: box.x, y: box.y })
	}
	const origin = graph.previousOrigin ?? firstCorner(placed)
	return { origin, positions }
}

/**
 * Move a shape Claude just drew as little as needed to keep clear of
 * everything else on the page, the user's shapes beyond anchor reach: the
 * guard for content placed by rules of its own (a new question card below
 * the graph), so it takes over none of the user's anchors (ADR 0008).
 */
export function moveIntoFreeSpace(editor: Editor, id: TLShapeId): void {
	const shape = editor.getShape(id)
	const bounds = editor.getShapePageBounds(id)
	if (!shape || !bounds) return
	const obstacles = obstaclesOnPage(editor, new Set([id]))
	const free = nearestFree(bounds, obstacles) ?? belowEverything(bounds, obstacles)
	if (free.x === bounds.x && free.y === bounds.y) return
	editor.updateShape({
		id,
		type: shape.type,
		x: shape.x + free.x - bounds.x,
		y: shape.y + free.y - bounds.y,
	})
}

/** The whole layout of a new graph, moved as little as needed to keep clear of what is on the page. */
function layOutWholeGraphInFreeSpace(
	editor: Editor,
	graph: GraphToPlace,
	obstacles: Obstacle[],
): GraphPlacement {
	const whole = layOutWholeGraph(editor, graph)
	const block = Box.Common(
		graph.nodes.flatMap((node) => {
			const at = whole.positions.get(node.id)
			return at ? [new Box(at.x, at.y, node.w, node.h)] : []
		}),
	)
	const free = nearestFree(block, obstacles) ?? belowEverything(block, obstacles)
	const dx = free.x - block.x
	const dy = free.y - block.y
	if (dx === 0 && dy === 0) return whole
	return {
		origin: { x: whole.origin.x + dx, y: whole.origin.y + dy },
		positions: new Map(
			[...whole.positions].map(([id, { x, y }]) => [id, { x: x + dx, y: y + dy }]),
		),
	}
}

/** Where a new node goes: its rank slot beside what it is about, else the nearest free spot. */
function findSpot(
	node: LayoutNode,
	graph: GraphToPlace,
	placed: Map<string, Box>,
	obstacles: Obstacle[],
): Box {
	const around = (ids: string[]) => ids.flatMap((id) => placed.get(id) ?? [])
	const blockers = around(graph.edges.filter((e) => e.to === node.id).map((e) => e.from))
	const dependents = around(graph.edges.filter((e) => e.from === node.id).map((e) => e.to))
	const middleY = (boxes: Box[]) =>
		Math.round(boxes.reduce((sum, box) => sum + box.center.y, 0) / boxes.length - node.h / 2)

	let slot: Box
	if (blockers.length > 0) {
		// Right of its rightmost blocker, level with the middle of them all.
		slot = new Box(
			Math.max(...blockers.map((box) => box.maxX)) + RANK_GAP,
			middleY(blockers),
			node.w,
			node.h,
		)
	} else if (dependents.length > 0) {
		// A new blocker of nodes already drawn goes left of them.
		slot = new Box(
			Math.min(...dependents.map((box) => box.minX)) - RANK_GAP - node.w,
			middleY(dependents),
			node.w,
			node.h,
		)
	} else {
		// Unconnected to anything placed: under the graph.
		const graphBounds = Box.Common([...placed.values()])
		slot = new Box(graphBounds.minX, graphBounds.maxY + CLAUDE_CLEARANCE, node.w, node.h)
	}
	return (
		freeInColumn(slot, obstacles) ??
		nearestFree(slot, obstacles) ??
		belowEverything(slot, obstacles)
	)
}

/** The free spot nearest `slot` straight above or below it, within {@link COLUMN_REACH}. */
function freeInColumn(slot: Box, obstacles: Obstacle[]): Box | undefined {
	for (let offset = 0; offset <= COLUMN_REACH; offset += STEP) {
		for (const dy of offset === 0 ? [0] : [offset, -offset]) {
			const box = new Box(slot.x, slot.y + dy, slot.w, slot.h)
			if (isFree(box, obstacles)) return box
		}
	}
	return undefined
}

/** The free spot nearest `target`, walking square rings of the grid outwards. */
function nearestFree(target: Box, obstacles: Obstacle[]): Box | undefined {
	for (let ring = 0; ring <= MAX_RINGS; ring++) {
		let best: Box | undefined
		let bestDistance = Number.POSITIVE_INFINITY
		for (const [dx, dy] of ringOffsets(ring)) {
			const box = new Box(target.x + dx * STEP, target.y + dy * STEP, target.w, target.h)
			const distance = Math.hypot(dx, dy)
			if (distance < bestDistance && isFree(box, obstacles)) {
				best = box
				bestDistance = distance
			}
		}
		if (best) return best
	}
	return undefined
}

/** Always free: under everything on the page, at `target`'s x. */
function belowEverything(target: Box, obstacles: Obstacle[]): Box {
	const bottom = Math.max(
		target.y,
		...obstacles.map((obstacle) => obstacle.bounds.maxY + obstacle.clearance),
	)
	return new Box(target.x, bottom, target.w, target.h)
}

function isFree(box: Box, obstacles: Obstacle[]): boolean {
	return obstacles.every(
		({ bounds, clearance }) => !Box.Collides(Box.ExpandBy(box, clearance), bounds),
	)
}

/** The grid offsets on the square ring `ring` steps out from the centre. */
export function ringOffsets(ring: number): [number, number][] {
	if (ring === 0) return [[0, 0]]
	const offsets: [number, number][] = []
	for (let i = -ring; i <= ring; i++) offsets.push([i, -ring], [i, ring])
	for (let i = -ring + 1; i < ring; i++) offsets.push([-ring, i], [ring, i])
	return offsets
}

/**
 * What takes up room on the page: every top-level shape but arrows (they
 * follow the shapes they connect) and the new nodes about to be placed.
 */
function obstaclesOnPage(editor: Editor, unplaced: ReadonlySet<TLShapeId>): Obstacle[] {
	return editor
		.getCurrentPageShapes()
		.filter((shape) => shape.parentId === editor.getCurrentPageId())
		.filter((shape) => shape.type !== 'arrow' && !unplaced.has(shape.id))
		.flatMap((shape) => {
			const bounds = editor.getShapePageBounds(shape.id)
			if (!bounds) return []
			return [{ bounds, clearance: isClaudeShape(shape) ? CLAUDE_CLEARANCE : USER_CLEARANCE }]
		})
}

/**
 * The new nodes in an order that places a node's new blockers before it
 * (graph order otherwise; nodes on a cycle among the new ones in graph order).
 */
function blockersFirst(newNodes: LayoutNode[], graph: GraphToPlace): LayoutNode[] {
	const isNew = new Set(newNodes.map((node) => node.id))
	const waitingFor = new Map(newNodes.map((node) => [node.id, 0]))
	for (const edge of graph.edges) {
		if (isNew.has(edge.from) && isNew.has(edge.to) && edge.from !== edge.to)
			waitingFor.set(edge.to, (waitingFor.get(edge.to) ?? 0) + 1)
	}
	const ordered: LayoutNode[] = []
	const remaining = [...newNodes]
	while (remaining.length > 0) {
		const index = Math.max(
			0,
			remaining.findIndex((node) => waitingFor.get(node.id) === 0),
		)
		const [next] = remaining.splice(index, 1)
		if (!next) break
		ordered.push(next)
		for (const edge of graph.edges) {
			if (edge.from === next.id && waitingFor.has(edge.to))
				waitingFor.set(edge.to, (waitingFor.get(edge.to) ?? 0) - 1)
		}
	}
	return ordered
}

function firstCorner(placed: Map<string, Box>): { x: number; y: number } {
	const { x, y } = Box.Common([...placed.values()])
	return { x, y }
}
