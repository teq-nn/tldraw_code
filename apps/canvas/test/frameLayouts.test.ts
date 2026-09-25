import { describe, expect, it } from 'vitest'
import { layoutFrames } from '../src/diagram/frameLayouts'
import type { LayoutEdge, LayoutResult } from '../src/graph/layout'

const node = (id: string) => ({ id, w: 180, h: 70 })
const chain = (...ids: string[]): LayoutEdge[] =>
	ids.slice(1).map((to, index) => ({ from: ids[index] as string, to }))
const frame = (ids: string[], edges: LayoutEdge[]) => ({ nodes: ids.map(node), edges })

function at(layout: LayoutResult | undefined, id: string) {
	const position = layout?.positions.get(id)
	if (!position) throw new Error(`no position for ${id}`)
	return position
}

/** The nodes of a chain, in edge order, sit on one line from left to right. */
function expectStraightLine(layout: LayoutResult | undefined, ids: string[]) {
	const xs = ids.map((id) => at(layout, id).x)
	expect([...xs].sort((a, b) => a - b)).toEqual(xs)
	expect(new Set(ids.map((id) => at(layout, id).y)).size).toBe(1)
}

describe('layoutFrames', () => {
	it('shares one layout when every alternative reads left to right in it', () => {
		const layouts = layoutFrames([
			frame(['api', 'db'], chain('api', 'db')),
			frame(['api', 'queue', 'worker', 'db'], chain('api', 'queue', 'worker', 'db')),
		])
		expect(at(layouts[0], 'api')).toEqual(at(layouts[1], 'api'))
		expect(at(layouts[0], 'db')).toEqual(at(layouts[1], 'db'))
		expect(at(layouts[1], 'api').x).toBeLessThan(at(layouts[1], 'queue').x)
	})

	it('lays a linear flow out as a straight line in edge order, whatever the node order (#23)', () => {
		// The same five steps, listed in one order but connected in another.
		const ids = ['press', 'advertise', 'slot', 'remember', 'wait']
		const [a, b] = layoutFrames([
			frame(ids, chain('press', 'advertise', 'wait', 'slot', 'remember')),
			frame(ids, chain('press', 'advertise', 'slot', 'wait', 'remember')),
		])
		expectStraightLine(a, ['press', 'advertise', 'wait', 'slot', 'remember'])
		expectStraightLine(b, ['press', 'advertise', 'slot', 'wait', 'remember'])
	})

	it('keeps every edge of every alternative pointing right when their orders conflict', () => {
		const edgesA = [...chain('a', 'b', 'c', 'd'), { from: 'a', to: 'e' }]
		const edgesB = [...chain('a', 'c', 'b', 'd'), { from: 'e', to: 'd' }]
		const layouts = layoutFrames([
			frame(['a', 'b', 'c', 'd', 'e'], edgesA),
			frame(['a', 'b', 'c', 'd', 'e'], edgesB),
		])
		for (const [index, edges] of [edgesA, edgesB].entries()) {
			for (const { from, to } of edges)
				expect(at(layouts[index], from).x).toBeLessThan(at(layouts[index], to).x)
		}
	})

	it('tolerates cycles inside one alternative', () => {
		const layouts = layoutFrames([frame(['a', 'b'], [...chain('a', 'b'), { from: 'b', to: 'a' }])])
		expect(layouts[0]?.positions.size).toBe(2)
	})

	it('is deterministic', () => {
		const frames = [
			frame(['a', 'b', 'c'], chain('a', 'b', 'c')),
			frame(['a', 'b', 'c'], chain('a', 'c', 'b')),
		]
		expect(layoutFrames(frames)).toEqual(layoutFrames(frames))
	})
})
