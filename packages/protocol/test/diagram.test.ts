import { describe, expect, it } from 'vitest'
import {
	CompareSchema,
	type DiagramSpec,
	DiagramSpecSchema,
	diffAlternatives,
	RenderDiagramSchema,
} from '../src'

const direct: DiagramSpec = {
	nodes: [
		{ id: 'api', label: 'API' },
		{ id: 'db', label: 'Database', look: 'ellipse' },
	],
	edges: [{ from: 'api', to: 'db', label: 'writes' }],
}

const queued: DiagramSpec = {
	nodes: [
		{ id: 'api', label: 'API' },
		{ id: 'queue', label: 'Queue' },
		{ id: 'worker', label: 'Worker' },
		{ id: 'db', label: 'Database', look: 'ellipse' },
	],
	edges: [
		{ from: 'api', to: 'queue' },
		{ from: 'queue', to: 'worker' },
		{ from: 'worker', to: 'db', label: 'writes' },
	],
}

function issues(result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) {
	return result.error?.issues.map((issue) => issue.path.join('.')) ?? []
}

describe('DiagramSpecSchema', () => {
	it('accepts a diagram and defaults edges to none', () => {
		const parsed = DiagramSpecSchema.parse({ nodes: [{ id: 'a', label: 'A' }] })
		expect(parsed.edges).toEqual([])
	})

	it('rejects duplicate node ids, unknown edge ends, self-edges and duplicate edges', () => {
		const result = DiagramSpecSchema.safeParse({
			nodes: [
				{ id: 'a', label: 'A' },
				{ id: 'a', label: 'A again' },
				{ id: 'b', label: 'B' },
			],
			edges: [
				{ from: 'a', to: 'x' },
				{ from: 'b', to: 'b' },
				{ from: 'a', to: 'b' },
				{ from: 'a', to: 'b' },
			],
		})
		expect(issues(result)).toEqual(['nodes.1.id', 'edges.0.to', 'edges.1', 'edges.3'])
	})

	it('rejects an unknown look', () => {
		expect(
			DiagramSpecSchema.safeParse({ nodes: [{ id: 'a', label: 'A', look: 'star' }] }).success,
		).toBe(false)
	})
})

describe('RenderDiagramSchema', () => {
	it('reports spec errors under spec', () => {
		const result = RenderDiagramSchema.safeParse({
			id: 'flow',
			spec: { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'b' }] },
		})
		expect(issues(result)).toEqual(['spec.edges.0.to'])
	})
})

describe('CompareSchema', () => {
	const input = {
		id: 'ingest',
		question: 'Which data flow?',
		items: [
			{ label: 'Direct', spec: direct },
			{ label: 'Queued', caption: 'Writes go through a queue.', spec: queued },
		],
		recommendation: 'Queued',
	}

	it('accepts 2 or 3 labelled alternatives with a recommendation among them', () => {
		expect(CompareSchema.safeParse(input).success).toBe(true)
	})

	it('rejects a single alternative and more than three', () => {
		expect(CompareSchema.safeParse({ ...input, items: [input.items[0]] }).success).toBe(false)
		const four = ['A', 'B', 'C', 'D'].map((label) => ({ label, spec: direct }))
		expect(CompareSchema.safeParse({ ...input, items: four, recommendation: 'A' }).success).toBe(
			false,
		)
	})

	it('rejects duplicate labels, "Keep grilling" and a recommendation that is no label', () => {
		const result = CompareSchema.safeParse({
			...input,
			items: [
				{ label: 'Direct', spec: direct },
				{ label: 'direct', spec: queued },
				{ label: 'Keep grilling', spec: queued },
			],
			recommendation: 'Queued',
		})
		expect(issues(result)).toEqual(['items.1.label', 'items.2.label', 'recommendation'])
	})

	it('checks the spec of every item', () => {
		const result = CompareSchema.safeParse({
			...input,
			items: [
				input.items[0],
				{
					label: 'Queued',
					spec: { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'z' }] },
				},
			],
		})
		expect(issues(result)).toEqual(['items.1.spec.edges.0.to'])
	})
})

describe('diffAlternatives', () => {
	it('marks the nodes and edges that not every alternative has', () => {
		const [a, b] = diffAlternatives([direct, queued])
		expect(a).toEqual({ nodes: [], edges: [{ id: 'api->db', kind: 'not_in_all' }] })
		expect(b).toEqual({
			nodes: [
				{ id: 'queue', kind: 'not_in_all' },
				{ id: 'worker', kind: 'not_in_all' },
			],
			edges: [
				{ id: 'api->queue', kind: 'not_in_all' },
				{ id: 'queue->worker', kind: 'not_in_all' },
				{ id: 'worker->db', kind: 'not_in_all' },
			],
		})
	})

	it('marks elements every alternative has but with a different label or look as changed', () => {
		const relabelled: DiagramSpec = {
			nodes: [
				{ id: 'api', label: 'Gateway' },
				{ id: 'db', label: 'Database' },
			],
			edges: [{ from: 'api', to: 'db', label: 'reads' }],
		}
		const [a, b] = diffAlternatives([direct, relabelled])
		const changed = {
			nodes: [
				{ id: 'api', kind: 'changed' },
				{ id: 'db', kind: 'changed' },
			],
			edges: [{ id: 'api->db', kind: 'changed' }],
		}
		expect(a).toEqual(changed)
		expect(b).toEqual(changed)
	})

	it('with three alternatives, an element missing from one differs in all that have it', () => {
		const [a, b, c] = diffAlternatives([direct, direct, queued])
		expect(a?.edges).toEqual([{ id: 'api->db', kind: 'not_in_all' }])
		expect(b?.edges).toEqual([{ id: 'api->db', kind: 'not_in_all' }])
		expect(c?.nodes.map((n) => n.id)).toEqual(['queue', 'worker'])
		expect(a?.nodes).toEqual([])
	})

	it('finds nothing between identical alternatives', () => {
		expect(diffAlternatives([direct, direct])).toEqual([
			{ nodes: [], edges: [] },
			{ nodes: [], edges: [] },
		])
	})
})
