import { describe, expect, it } from 'vitest'
import { layoutGraph } from '../src/graph/layout'

const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id, w: 200, h: 80 }))
const edges = [
	{ from: 'a', to: 'b' },
	{ from: 'a', to: 'c' },
	{ from: 'b', to: 'd' },
	{ from: 'c', to: 'd' },
]

describe('layoutGraph', () => {
	it('puts blockers left of what they block', () => {
		const { positions } = layoutGraph(nodes, edges)
		const x = (id: string) => positions.get(id)?.x ?? Number.NaN
		expect(x('a')).toBeLessThan(x('b'))
		expect(x('b')).toBeLessThan(x('d'))
		expect(x('b')).toBe(x('c'))
	})

	it('starts at the origin and reports its size', () => {
		const { positions, width, height } = layoutGraph(nodes, edges)
		const all = [...positions.values()]
		expect(Math.min(...all.map((p) => p.x))).toBe(0)
		expect(Math.min(...all.map((p) => p.y))).toBe(0)
		expect(width).toBe(Math.max(...all.map((p) => p.x + 200)))
		expect(height).toBe(Math.max(...all.map((p) => p.y + 80)))
	})

	it('is deterministic', () => {
		expect(layoutGraph(nodes, edges)).toEqual(layoutGraph(nodes, edges))
	})

	it('copes with cycles', () => {
		const { positions } = layoutGraph(nodes.slice(0, 2), [
			{ from: 'a', to: 'b' },
			{ from: 'b', to: 'a' },
		])
		expect(positions.size).toBe(2)
	})
})
