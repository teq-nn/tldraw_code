import { describe, expect, it } from 'vitest'
import { computeFrontier, type FrontierGraph, FrontierGraphSchema } from '../src'

function graph(nodes: FrontierGraph['nodes'], edges: FrontierGraph['edges'] = []): FrontierGraph {
	return { nodes, edges }
}

describe('computeFrontier', () => {
	it('contains open nodes without blockers', () => {
		expect(
			computeFrontier(
				graph([
					{ id: 'a', title: 'A', status: 'open' },
					{ id: 'b', title: 'B', status: 'open' },
				]),
			),
		).toEqual(['a', 'b'])
	})

	it('contains open nodes whose blockers are all resolved', () => {
		const g = graph(
			[
				{ id: 'a', title: 'A', status: 'resolved' },
				{ id: 'b', title: 'B', status: 'resolved' },
				{ id: 'c', title: 'C', status: 'open' },
			],
			[
				{ from: 'a', to: 'c' },
				{ from: 'b', to: 'c' },
			],
		)
		expect(computeFrontier(g)).toEqual(['c'])
	})

	it('excludes open nodes with an unresolved blocker', () => {
		const g = graph(
			[
				{ id: 'a', title: 'A', status: 'resolved' },
				{ id: 'b', title: 'B', status: 'blocked' },
				{ id: 'c', title: 'C', status: 'open' },
			],
			[
				{ from: 'a', to: 'c' },
				{ from: 'b', to: 'c' },
			],
		)
		expect(computeFrontier(g)).toEqual([])
	})

	it('excludes resolved and blocked nodes even without blockers', () => {
		const g = graph([
			{ id: 'a', title: 'A', status: 'resolved' },
			{ id: 'b', title: 'B', status: 'blocked' },
		])
		expect(computeFrontier(g)).toEqual([])
	})

	it('never puts nodes of an unresolved cycle on the frontier', () => {
		const g = graph(
			[
				{ id: 'a', title: 'A', status: 'open' },
				{ id: 'b', title: 'B', status: 'open' },
			],
			[
				{ from: 'a', to: 'b' },
				{ from: 'b', to: 'a' },
			],
		)
		expect(computeFrontier(g)).toEqual([])
	})
})

describe('FrontierGraphSchema', () => {
	it('accepts a valid graph and defaults edges to none', () => {
		const parsed = FrontierGraphSchema.parse({ nodes: [{ id: 'a', title: 'A', status: 'open' }] })
		expect(parsed.edges).toEqual([])
	})

	it('rejects an empty graph', () => {
		expect(FrontierGraphSchema.safeParse({ nodes: [] }).success).toBe(false)
	})

	it('rejects ids with spaces', () => {
		const result = FrontierGraphSchema.safeParse({
			nodes: [{ id: 'a b', title: 'A', status: 'open' }],
		})
		expect(result.success).toBe(false)
	})
})
