import type { PageBox } from '@tldraw-code/protocol'
import { describe, expect, it } from 'vitest'
import {
	backwardEdges,
	blockAspect,
	boxGap,
	displacement,
	edgeLengthCv,
	nearestNeighbourPreserved,
	normalisedCrossings,
	orthogonalOrderPreserved,
	overlappingPairs,
	visibleFraction,
} from '../bench/metrics'

// The layout benchmark's metrics (issue #25, docs/research/canvas-layout.md §10),
// on tiny hand-made layouts whose answers can be checked by eye.

/** A 20 x 20 box centred on (x, y). */
const at = (x: number, y: number): PageBox => ({ x: x - 10, y: y - 10, w: 20, h: 20 })

describe('normalisedCrossings', () => {
	// Four corners of a square: a-b along the top, c-d along the bottom.
	const square = new Map([
		['a', at(0, 0)],
		['b', at(100, 0)],
		['c', at(0, 100)],
		['d', at(100, 100)],
	])

	it('is 1 when no two edges cross', () => {
		expect(
			normalisedCrossings(square, [
				{ from: 'a', to: 'b' },
				{ from: 'c', to: 'd' },
			]),
		).toBe(1)
	})

	it('is 0 when every pair of edges that could cross does', () => {
		// The two diagonals of the square cross; they are the only pair.
		expect(
			normalisedCrossings(square, [
				{ from: 'a', to: 'd' },
				{ from: 'c', to: 'b' },
			]),
		).toBe(0)
	})

	it('does not count edges sharing a node as a possible crossing', () => {
		// 4 edges make 6 pairs; 4 of them share a corner, so 2 could cross (the
		// diagonals, and top with bottom). Only the diagonals do.
		const edges = [
			{ from: 'a', to: 'd' },
			{ from: 'c', to: 'b' },
			{ from: 'a', to: 'b' },
			{ from: 'c', to: 'd' },
		]
		expect(normalisedCrossings(square, edges)).toBe(0.5)
	})

	it('is 1 for a graph too small to have a crossing', () => {
		expect(normalisedCrossings(square, [{ from: 'a', to: 'b' }])).toBe(1)
		expect(normalisedCrossings(square, [])).toBe(1)
	})
})

describe('backwardEdges', () => {
	it('counts the edges whose head is not to the right of their tail', () => {
		const nodes = new Map([
			['a', at(0, 0)],
			['b', at(100, 0)],
			['c', at(100, 100)],
		])
		// a->b points right; b->a points left; b->c points straight down.
		expect(
			backwardEdges(nodes, [
				{ from: 'a', to: 'b' },
				{ from: 'b', to: 'a' },
				{ from: 'b', to: 'c' },
			]),
		).toBe(2)
	})
})

describe('edgeLengthCv', () => {
	const nodes = new Map([
		['a', at(0, 0)],
		['b', at(100, 0)],
		['c', at(400, 0)],
	])

	it('is 0 when all edges are equally long', () => {
		expect(edgeLengthCv(nodes, [{ from: 'a', to: 'b' }])).toBe(0)
	})

	it('is the standard deviation of the edge lengths over their mean', () => {
		// Lengths 100 and 300: mean 200, standard deviation 100.
		expect(
			edgeLengthCv(nodes, [
				{ from: 'a', to: 'b' },
				{ from: 'b', to: 'c' },
			]),
		).toBeCloseTo(0.5)
	})
})

describe('blockAspect', () => {
	it('is 0 for a square block and |ln(w/h)| otherwise, whichever side is longer', () => {
		expect(blockAspect([at(0, 0), at(80, 80)])).toBe(0)
		// Two 20 x 20 boxes side by side, 20 apart: 60 x 20.
		expect(blockAspect([at(0, 0), at(40, 0)])).toBeCloseTo(Math.log(3))
		expect(blockAspect([at(0, 0), at(0, 40)])).toBeCloseTo(Math.log(3))
	})
})

describe('displacement', () => {
	it('is the mean and largest move of the nodes in both layouts, ignoring added and removed ones', () => {
		const before = new Map([
			['a', at(0, 0)],
			['b', at(100, 0)],
			['gone', at(500, 500)],
		])
		const after = new Map([
			['a', at(0, 0)],
			['b', at(130, 40)],
			['new', at(900, 900)],
		])
		// a stays, b moves 50 (a 30-40-50 triangle).
		expect(displacement(before, after)).toEqual({ mean: 25, max: 50 })
	})

	it('is 0 when nothing persists', () => {
		expect(displacement(new Map([['a', at(0, 0)]]), new Map())).toEqual({ mean: 0, max: 0 })
	})
})

describe('orthogonalOrderPreserved', () => {
	const before = new Map([
		['a', at(0, 0)],
		['b', at(100, 0)],
		['c', at(100, 100)],
	])

	it('is 1 when a layout moves as a whole', () => {
		const shifted = new Map([...before].map(([id, box]) => [id, { ...box, x: box.x + 300 }]))
		expect(orthogonalOrderPreserved(before, shifted)).toBe(1)
	})

	it('is the share of node pairs whose left/right and above/below relation is unchanged', () => {
		// b jumps left of a: pairs a-b and b-c change, a-c keeps its relation.
		const after = new Map([
			['a', at(0, 0)],
			['b', at(-100, 0)],
			['c', at(100, 100)],
		])
		expect(orthogonalOrderPreserved(before, after)).toBeCloseTo(1 / 3)
	})
})

describe('nearestNeighbourPreserved', () => {
	it('is the share of nodes whose nearest neighbour is unchanged', () => {
		const before = new Map([
			['a', at(0, 0)],
			['b', at(100, 0)],
			['c', at(1000, 0)],
		])
		// c moves next to a, so a's and c's nearest neighbour change; b's (a) does not.
		const after = new Map([
			['a', at(0, 0)],
			['b', at(100, 0)],
			['c', at(-50, 0)],
		])
		expect(nearestNeighbourPreserved(before, after)).toBeCloseTo(1 / 3)
		expect(nearestNeighbourPreserved(before, before)).toBe(1)
	})
})

describe('overlappingPairs', () => {
	const card = { label: 'card', bounds: { x: 0, y: 0, w: 100, h: 100 } }
	const node = { label: 'node', bounds: { x: 50, y: 50, w: 100, h: 100 } }
	const beside = { label: 'beside', bounds: { x: 100, y: 0, w: 100, h: 100 } }

	it('names every pair within one set whose bounds share some area', () => {
		// card and beside only touch along an edge; node overlaps both.
		expect(overlappingPairs([card, node, beside])).toEqual([
			['card', 'node'],
			['node', 'beside'],
		])
	})

	it('pairs across two sets when given two', () => {
		const note = { label: 'note', bounds: { x: 90, y: 90, w: 20, h: 20 } }
		expect(overlappingPairs([card, beside], [note])).toEqual([
			['card', 'note'],
			['beside', 'note'],
		])
	})
})

describe('boxGap', () => {
	it('is the shortest distance between two boxes, 0 when they touch or overlap', () => {
		const a = { x: 0, y: 0, w: 10, h: 10 }
		expect(boxGap(a, { x: 40, y: 0, w: 10, h: 10 })).toBe(30)
		expect(boxGap(a, { x: 40, y: 50, w: 10, h: 10 })).toBe(50)
		expect(boxGap(a, { x: 10, y: 5, w: 10, h: 10 })).toBe(0)
	})
})

describe('visibleFraction', () => {
	const viewport = { x: 0, y: 0, w: 100, h: 100 }

	it('is the share of the content inside the viewport', () => {
		expect(visibleFraction({ x: 10, y: 10, w: 50, h: 50 }, viewport)).toBe(1)
		expect(visibleFraction({ x: 50, y: 0, w: 100, h: 100 }, viewport)).toBe(0.5)
		expect(visibleFraction({ x: 200, y: 0, w: 10, h: 10 }, viewport)).toBe(0)
	})
})
