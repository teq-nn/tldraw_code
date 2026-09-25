import type { PageBox } from '@tldraw-code/protocol'

/**
 * The layout benchmark's metrics (issue #25, docs/research/canvas-layout.md
 * §10): pure geometry on page boxes, so any layout flavour is scored the
 * same way. An edge is drawn as the straight segment between the centres of
 * its nodes, as the canvas draws a dependency.
 */

export interface Edge {
	from: string
	to: string
}

type Point = { x: number; y: number }

export function centre(box: PageBox): Point {
	return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

/**
 * Crossings, normalised: `1 − c / c_max`, where `c` counts pairs of edges that
 * cross and `c_max` the pairs that could (those not sharing a node). 1 means
 * no crossings, 0 as many as possible.
 */
export function normalisedCrossings(nodes: ReadonlyMap<string, PageBox>, edges: Edge[]): number {
	const drawn = segments(nodes, edges)
	let possible = 0
	let crossings = 0
	for (let i = 0; i < drawn.length; i++) {
		for (let j = i + 1; j < drawn.length; j++) {
			const a = drawn[i]
			const b = drawn[j]
			if (!a || !b || sharesNode(a.edge, b.edge)) continue
			possible++
			if (segmentsCross(a.start, a.end, b.start, b.end)) crossings++
		}
	}
	return possible === 0 ? 1 : 1 - crossings / possible
}

function segments(nodes: ReadonlyMap<string, PageBox>, edges: Edge[]) {
	return edges.flatMap((edge) => {
		const from = nodes.get(edge.from)
		const to = nodes.get(edge.to)
		return from && to ? [{ edge, start: centre(from), end: centre(to) }] : []
	})
}

function sharesNode(a: Edge, b: Edge): boolean {
	return a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to
}

/** Whether two segments cross at a point inside both (touching ends do not count). */
function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
	const d1 = turn(q1, q2, p1)
	const d2 = turn(q1, q2, p2)
	const d3 = turn(p1, p2, q1)
	const d4 = turn(p1, p2, q2)
	return d1 * d2 < 0 && d3 * d4 < 0
}

/** Sign of the turn a → b → c: positive left, negative right, 0 collinear. */
function turn(a: Point, b: Point, c: Point): number {
	return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
}

/** Edges that do not point in the rank direction (left to right, ADR 0004): head left of or level with the tail. */
export function backwardEdges(nodes: ReadonlyMap<string, PageBox>, edges: Edge[]): number {
	return segments(nodes, edges).filter(({ start, end }) => end.x <= start.x).length
}

/** Coefficient of variation of the edge lengths (standard deviation over mean); 0 when all are equal. */
export function edgeLengthCv(nodes: ReadonlyMap<string, PageBox>, edges: Edge[]): number {
	const lengths = segments(nodes, edges).map(({ start, end }) => distance(start, end))
	const mean = average(lengths)
	if (mean === 0) return 0
	return Math.sqrt(average(lengths.map((length) => (length - mean) ** 2))) / mean
}

/** How far the block of boxes is from square: |ln(w/h)| (ADR 0029), 0 for a square. */
export function blockAspect(boxes: PageBox[]): number {
	const block = union(boxes)
	return block ? Math.abs(Math.log(block.w / Math.max(1, block.h))) : 0
}

/** The smallest box containing all boxes; undefined for none. */
export function union(boxes: PageBox[]): PageBox | undefined {
	if (boxes.length === 0) return undefined
	const minX = Math.min(...boxes.map((box) => box.x))
	const minY = Math.min(...boxes.map((box) => box.y))
	const maxX = Math.max(...boxes.map((box) => box.x + box.w))
	const maxY = Math.max(...boxes.map((box) => box.y + box.h))
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

function distance(a: Point, b: Point): number {
	return Math.hypot(b.x - a.x, b.y - a.y)
}

function average(values: number[]): number {
	return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Nodes in both layouts, with their centres before and after. */
function persisting(before: ReadonlyMap<string, PageBox>, after: ReadonlyMap<string, PageBox>) {
	return [...before].flatMap(([id, box]) => {
		const moved = after.get(id)
		return moved ? [{ id, before: centre(box), after: centre(moved) }] : []
	})
}

/**
 * How far the nodes present in both layouts moved, in page units: mean and
 * largest. Not aligned first: the canvas keeps a graph's origin, so every
 * unit counted here is a unit the user sees a node jump.
 */
export function displacement(
	before: ReadonlyMap<string, PageBox>,
	after: ReadonlyMap<string, PageBox>,
): { mean: number; max: number } {
	const moves = persisting(before, after).map((node) => distance(node.before, node.after))
	return { mean: average(moves), max: moves.length === 0 ? 0 : Math.max(...moves) }
}

/** Offsets smaller than this count as level (same rank, same row). */
const LEVEL_TOLERANCE = 1

/**
 * Orthogonal-ordering preservation: the share of pairs of persisting nodes
 * whose relation (left of, level with or right of; above, level with or
 * below) is the same in both layouts. 1 when fewer than two nodes persist.
 */
export function orthogonalOrderPreserved(
	before: ReadonlyMap<string, PageBox>,
	after: ReadonlyMap<string, PageBox>,
): number {
	const nodes = persisting(before, after)
	const side = (from: number, to: number) =>
		Math.abs(to - from) < LEVEL_TOLERANCE ? 0 : Math.sign(to - from)
	let pairs = 0
	let kept = 0
	for (let i = 0; i < nodes.length; i++) {
		for (let j = i + 1; j < nodes.length; j++) {
			const a = nodes[i]
			const b = nodes[j]
			if (!a || !b) continue
			pairs++
			if (
				side(a.before.x, b.before.x) === side(a.after.x, b.after.x) &&
				side(a.before.y, b.before.y) === side(a.after.y, b.after.y)
			) {
				kept++
			}
		}
	}
	return pairs === 0 ? 1 : kept / pairs
}

/**
 * Proximity preservation: the share of persisting nodes whose nearest
 * persisting neighbour is the same in both layouts. 1 when fewer than two
 * nodes persist.
 */
export function nearestNeighbourPreserved(
	before: ReadonlyMap<string, PageBox>,
	after: ReadonlyMap<string, PageBox>,
): number {
	const nodes = persisting(before, after)
	if (nodes.length < 2) return 1
	const nearest = (id: string, at: (node: (typeof nodes)[number]) => Point) => {
		const self = nodes.find((node) => node.id === id)
		if (!self) return undefined
		let best: { id: string; distance: number } | undefined
		for (const other of nodes) {
			if (other.id === id) continue
			const d = distance(at(self), at(other))
			if (!best || d < best.distance) best = { id: other.id, distance: d }
		}
		return best?.id
	}
	const kept = nodes.filter(
		(node) => nearest(node.id, (n) => n.before) === nearest(node.id, (n) => n.after),
	).length
	return kept / nodes.length
}

/** A shape on the canvas, named for the scorecard. */
export interface Labelled {
	label: string
	bounds: PageBox
}

/**
 * The pairs of shapes whose bounds share some area (touching edges do not
 * count): within `shapes`, or between `shapes` and `others` when given.
 */
export function overlappingPairs(shapes: Labelled[], others?: Labelled[]): [string, string][] {
	const pairs: [string, string][] = []
	shapes.forEach((a, i) => {
		for (const b of others ?? shapes.slice(i + 1)) {
			if (overlapArea(a.bounds, b.bounds) > 0) pairs.push([a.label, b.label])
		}
	})
	return pairs
}

function overlapArea(a: PageBox, b: PageBox): number {
	const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
	const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
	return w > 0 && h > 0 ? w * h : 0
}

/** Shortest distance between two boxes; 0 when they touch or overlap. */
export function boxGap(a: PageBox, b: PageBox): number {
	const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w))
	const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))
	return Math.hypot(dx, dy)
}

/** The share of `content` inside `viewport`: 1 fully visible, 0 out of sight. */
export function visibleFraction(content: PageBox, viewport: PageBox): number {
	const area = content.w * content.h
	return area === 0 ? 1 : overlapArea(content, viewport) / area
}
