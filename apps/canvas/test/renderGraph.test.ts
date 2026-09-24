// @vitest-environment jsdom
import {
	type CanvasCommandPayload,
	computeFrontier,
	type FrontierGraph,
} from '@tldraw-code/protocol'
import type { Editor, TLArrowBinding, TLArrowShape, TLGeoShape, TLShapeId } from 'tldraw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCommandHandlers } from '../src/bridge/commandHandlers'
import { edgeShapeId, nodeShapeId } from '../src/graph/renderGraph'
import { createTestEditor } from './createTestEditor'

let editor: Editor

beforeEach(() => {
	editor = createTestEditor()
})

afterEach(() => editor.dispose())

// a (resolved) -> b (open) -> d (open); c (open, no blockers); e (blocked)
const graph: FrontierGraph = {
	nodes: [
		{ id: 'a', title: 'Storage engine', status: 'resolved', note: 'SQLite' },
		{ id: 'b', title: 'Schema', status: 'open' },
		{ id: 'c', title: 'Auth', status: 'open' },
		{ id: 'd', title: 'Migrations', status: 'open' },
		{ id: 'e', title: 'Hosting', status: 'blocked' },
	],
	edges: [
		{ from: 'a', to: 'b' },
		{ from: 'b', to: 'd' },
		{ from: 'c', to: 'e' },
	],
}

function payload(g: FrontierGraph): CanvasCommandPayload<'graph.render'> {
	return { ...g, frontier: computeFrontier(g) }
}

function render(g: FrontierGraph) {
	return createCommandHandlers(editor)['graph.render'](payload(g))
}

function node(id: string): TLGeoShape {
	const shape = editor.getShape<TLGeoShape>(nodeShapeId(id))
	if (!shape) throw new Error(`no shape for node ${id}`)
	return shape
}

function shapesOfType(type: string) {
	return editor.getCurrentPageShapes().filter((shape) => shape.type === type)
}

function arrowEnds(from: string, to: string) {
	const bindings = editor.getBindingsFromShape<TLArrowBinding>(edgeShapeId(from, to), 'arrow')
	const end = (terminal: string) => bindings.find((b) => b.props.terminal === terminal)?.toId
	return { start: end('start'), end: end('end') }
}

describe('graph.render', () => {
	it('draws every node as a labelled rectangle and every edge as an arrow bound to both nodes', async () => {
		const result = await render(graph)

		expect(shapesOfType('geo')).toHaveLength(5)
		expect(shapesOfType('arrow')).toHaveLength(3)
		expect(node('b').props.geo).toBe('rectangle')
		expect(JSON.stringify(node('a').props.richText)).toContain('Storage engine')
		expect(JSON.stringify(node('a').props.richText)).toContain('SQLite')
		expect(arrowEnds('a', 'b')).toEqual({ start: nodeShapeId('a'), end: nodeShapeId('b') })
		expect(result).toEqual({
			nodes: { created: 5, updated: 0, removed: 0 },
			edges: { created: 3, updated: 0, removed: 0 },
			questionCollapsed: false,
		})
	})

	it('colours nodes by status', async () => {
		await render(graph)
		expect(node('a').props.color).toBe('green')
		expect(node('b').props.color).toBe('blue')
		expect(node('e').props.color).toBe('red')
	})

	it('highlights the frontier and only the frontier', async () => {
		await render(graph)
		const highlighted = ['a', 'b', 'c', 'd', 'e'].filter((id) => node(id).props.fill === 'solid')
		expect(highlighted).toEqual(['b', 'c'])
		expect(node('b').props.size).not.toBe(node('d').props.size)
	})

	it('lays the graph out left to right without overlapping nodes', async () => {
		await render(graph)
		const bounds = (id: string) => {
			const b = editor.getShapePageBounds(nodeShapeId(id))
			if (!b) throw new Error(`no bounds for ${id}`)
			return b
		}
		expect(bounds('a').maxX).toBeLessThan(bounds('b').minX)
		expect(bounds('b').maxX).toBeLessThan(bounds('d').minX)
		const ids = ['a', 'b', 'c', 'd', 'e']
		for (const x of ids) {
			for (const y of ids) {
				if (x < y) expect(bounds(x).collides(bounds(y)), `${x} overlaps ${y}`).toBe(false)
			}
		}
	})

	it('places a new graph in view', async () => {
		await render(graph)
		const bounds = editor.getShapesPageBounds(graph.nodes.map((n) => nodeShapeId(n.id)))
		expect(bounds && editor.getViewportPageBounds().contains(bounds)).toBe(true)
	})

	it('shows a note as an italic label under the plain title', async () => {
		await render(graph)
		const [title, note] = node('a').props.richText.content as {
			content: { text: string; marks?: { type: string }[] }[]
		}[]
		expect(title?.content).toEqual([{ type: 'text', text: 'Storage engine' }])
		expect(note?.content).toEqual([{ type: 'text', text: 'SQLite', marks: [{ type: 'italic' }] }])
		expect(node('b').props.richText.content).toHaveLength(1)
	})

	it('updates shapes in place when rendered again instead of duplicating them', async () => {
		await render(graph)
		const before = editor.getCurrentPageShapeIds()

		const result = await render({
			...graph,
			nodes: graph.nodes.map((n) =>
				n.id === 'b' ? { ...n, status: 'resolved', note: 'Normalised tables' } : n,
			),
		})

		expect(editor.getCurrentPageShapeIds()).toEqual(before)
		expect(node('b').props.color).toBe('green')
		expect(JSON.stringify(node('b').props.richText)).toContain('Normalised tables')
		// b is resolved now, so d joins the frontier.
		expect(node('d').props.fill).toBe('solid')
		expect(arrowEnds('a', 'b')).toEqual({ start: nodeShapeId('a'), end: nodeShapeId('b') })
		expect(editor.getBindingsFromShape(edgeShapeId('a', 'b'), 'arrow')).toHaveLength(2)
		expect(result).toEqual({
			nodes: { created: 0, updated: 5, removed: 0 },
			edges: { created: 0, updated: 3, removed: 0 },
			questionCollapsed: false,
		})
	})

	it('adds new nodes and removes nodes and edges that are gone', async () => {
		await render(graph)

		const result = await render({
			nodes: [...graph.nodes.filter((n) => n.id !== 'e'), { id: 'f', title: 'CI', status: 'open' }],
			edges: [...graph.edges.filter((e) => e.to !== 'e'), { from: 'd', to: 'f' }],
		})

		expect(editor.getShape(nodeShapeId('e'))).toBeUndefined()
		expect(editor.getShape(edgeShapeId('c', 'e'))).toBeUndefined()
		expect(node('f')).toBeDefined()
		expect(arrowEnds('d', 'f')).toEqual({ start: nodeShapeId('d'), end: nodeShapeId('f') })
		expect(shapesOfType('geo')).toHaveLength(5)
		expect(shapesOfType('arrow')).toHaveLength(3)
		expect(result).toEqual({
			nodes: { created: 1, updated: 4, removed: 1 },
			edges: { created: 1, updated: 2, removed: 1 },
			questionCollapsed: false,
		})
	})

	it('keeps the graph where it is on the page when rendered again', async () => {
		await render(graph)
		const firstA = node('a')
		editor.setCamera({ x: -5000, y: -5000, z: 1 })

		await render(graph)

		expect({ x: node('a').x, y: node('a').y }).toEqual({ x: firstA.x, y: firstA.y })
	})

	it('restores a node the user moved to its laid-out position', async () => {
		await render(graph)
		const laidOut = { x: node('c').x, y: node('c').y }
		editor.updateShape({ id: nodeShapeId('c') as TLShapeId, type: 'geo', x: 9999, y: 9999 })

		await render(graph)

		expect({ x: node('c').x, y: node('c').y }).toEqual(laidOut)
	})

	it('leaves shapes that render_graph does not own alone', async () => {
		await createCommandHandlers(editor)['smoke.create_shape']({ text: 'mine' })
		await render(graph)
		await render({ nodes: [graph.nodes[0] as FrontierGraph['nodes'][number]], edges: [] })
		expect(shapesOfType('geo')).toHaveLength(2)
		expect(shapesOfType('arrow') as TLArrowShape[]).toHaveLength(0)
	})
})
