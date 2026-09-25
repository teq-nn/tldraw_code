// @vitest-environment jsdom
import {
	type CanvasCommandPayload,
	computeFrontier,
	type FrontierGraph,
} from '@tldraw-code/protocol'
import type { Editor } from 'tldraw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CommandHandlers } from '../src/bridge/BridgeClient'
import { findLayoutFlavour } from '../src/bridge/layoutFlavours'
import { nodeShapeId } from '../src/graph/renderGraph'
import { createTestEditor } from './createTestEditor'

// Layout flavour F1 "anchored" (issue #27): today's global dagre layout, made
// stable across updates.

let editor: Editor
let handlers: CommandHandlers

beforeEach(() => {
	editor = createTestEditor()
	const flavour = findLayoutFlavour('anchored')
	if (!flavour) throw new Error('the anchored flavour is not registered')
	handlers = flavour.createHandlers(editor)
})

afterEach(() => editor.dispose())

const node = (id: string, title = id) => ({ id, title, status: 'open' as const })

// Two ranks: a and b, then e, c and d. Adding x after e makes a fresh dagre
// layout flip both ranks (b above a, d above e above c).
const before: FrontierGraph = {
	nodes: ['a', 'b', 'c', 'd', 'e'].map((id) => node(id)),
	edges: [
		{ from: 'a', to: 'c' },
		{ from: 'b', to: 'd' },
		{ from: 'a', to: 'e' },
	],
}
const withX: FrontierGraph = {
	nodes: [...before.nodes, node('x')],
	edges: [...before.edges, { from: 'e', to: 'x' }],
}

function render(graph: FrontierGraph) {
	const payload: CanvasCommandPayload<'graph.render'> = {
		...graph,
		frontier: computeFrontier(graph),
	}
	return handlers['graph.render'](payload)
}

function bounds(id: string) {
	const box = editor.getShapePageBounds(nodeShapeId(id))
	if (!box) throw new Error(`no shape for node ${id}`)
	return box
}

/** Node ids per rank (left to right), each rank top to bottom. */
function ranks(ids: string[]): string[][] {
	const byX = new Map<number, string[]>()
	for (const id of ids) byX.set(bounds(id).x, [...(byX.get(bounds(id).x) ?? []), id])
	return [...byX.entries()]
		.sort(([x1], [x2]) => x1 - x2)
		.map(([, rank]) => rank.sort((m, n) => bounds(m).y - bounds(n).y))
}

describe('the anchored layout flavour', () => {
	it('keeps the in-rank order of persisting nodes when an update adds a node', async () => {
		await render(before)
		expect(ranks(['a', 'b', 'c', 'd', 'e'])).toEqual([
			['a', 'b'],
			['e', 'c', 'd'],
		])

		await render(withX)

		expect(ranks(['a', 'b', 'c', 'd', 'e'])).toEqual([
			['a', 'b'],
			['e', 'c', 'd'],
		])
		expect(bounds('x').x).toBeGreaterThan(bounds('e').x)
	})

	it('places every node where it was when a call lists the same graph in another order', async () => {
		await render(withX)
		const where = () => withX.nodes.map(({ id }) => [id, bounds(id).x, bounds(id).y])
		const first = where()

		await render({ nodes: [...withX.nodes].reverse(), edges: [...withX.edges].reverse() })

		expect(where()).toEqual(first)
	})
})
