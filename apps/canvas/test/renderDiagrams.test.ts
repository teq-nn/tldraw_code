// @vitest-environment jsdom
import {
	type CanvasCommandPayload,
	type DiagramSpec,
	diffAlternatives,
	edgeKey,
} from '@tldraw-code/protocol'
import {
	createShapeId,
	type Editor,
	type TLArrowBinding,
	type TLArrowShape,
	type TLFrameShape,
	type TLGeoShape,
	type TLNoteShape,
	toRichText,
} from 'tldraw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { questionCardId } from '../src/ask/showQuestion'
import { createCommandHandlers } from '../src/bridge/commandHandlers'
import {
	DIFFERENCE_COLOR,
	diagramEdgeId,
	diagramFrameId,
	diagramNodeId,
} from '../src/diagram/renderDiagrams'
import { nodeShapeId } from '../src/graph/renderGraph'
import { createTestEditor } from './createTestEditor'

let editor: Editor

beforeEach(() => {
	editor = createTestEditor()
})

afterEach(() => editor.dispose())

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

type Payload = CanvasCommandPayload<'diagram.render'>

function handlers() {
	return createCommandHandlers(editor)
}

function renderDiagram(spec: DiagramSpec, id = 'flow', title = 'Data flow') {
	const payload: Payload = {
		kind: 'diagram',
		id,
		frames: [{ title, ...spec, highlight: { nodes: [], edges: [] } }],
	}
	return handlers()['diagram.render'](payload)
}

/** What the MCP server sends for `compare`: the highlights come from the diff. */
function renderComparison(specs: DiagramSpec[], id = 'ingest') {
	const diffs = diffAlternatives(specs)
	const payload: Payload = {
		kind: 'comparison',
		id,
		frames: specs.map((spec, index) => ({
			title: ['Direct', 'Queued', 'Batched'][index] ?? `Option ${index}`,
			caption: `Alternative ${index + 1}`,
			...spec,
			highlight: {
				nodes: diffs[index]?.nodes.map((d) => d.id) ?? [],
				edges: diffs[index]?.edges.map((d) => d.id) ?? [],
			},
		})),
	}
	return handlers()['diagram.render'](payload)
}

function geo(id: ReturnType<typeof diagramNodeId>): TLGeoShape {
	const shape = editor.getShape<TLGeoShape>(id)
	if (!shape) throw new Error(`no shape ${id}`)
	return shape
}

function frame(kind: 'diagram' | 'comparison', id: string, index: number): TLFrameShape {
	const shape = editor.getShape<TLFrameShape>(diagramFrameId(kind, id, index))
	if (!shape) throw new Error(`no frame ${kind}:${id}#${index}`)
	return shape
}

function pageBounds(id: Parameters<Editor['getShapePageBounds']>[0]) {
	const bounds = editor.getShapePageBounds(id)
	if (!bounds) throw new Error(`no bounds for ${id}`)
	return bounds
}

describe('diagram.render (render_diagram)', () => {
	it('draws the diagram as native geo shapes and bound arrows inside a titled frame', async () => {
		const result = await renderDiagram(direct)
		const frameShape = frame('diagram', 'flow', 0)

		expect(result.frameIds).toEqual([frameShape.id])
		expect(frameShape.props.name).toBe('Data flow')
		const api = geo(diagramNodeId('diagram', 'flow', 0, 'api'))
		const db = geo(diagramNodeId('diagram', 'flow', 0, 'db'))
		expect(api.parentId).toBe(frameShape.id)
		expect(api.props.geo).toBe('rectangle')
		expect(db.props.geo).toBe('ellipse')
		expect(JSON.stringify(db.props.richText)).toContain('Database')

		const arrowId = diagramEdgeId('diagram', 'flow', 0, { from: 'api', to: 'db' })
		const arrow = editor.getShape<TLArrowShape>(arrowId)
		expect(JSON.stringify(arrow?.props.richText)).toContain('writes')
		const bindings = editor.getBindingsFromShape<TLArrowBinding>(arrowId, 'arrow')
		expect(bindings.map((b) => [b.props.terminal, b.toId]).sort()).toEqual([
			['end', db.id],
			['start', api.id],
		])
		expect(result.nodes).toEqual({ created: 2, updated: 0, removed: 0 })
		expect(result.edges).toEqual({ created: 1, updated: 0, removed: 0 })
	})

	it('lays the diagram out left to right, like the frontier graph, inside the frame', async () => {
		await renderDiagram(queued)
		const box = (id: string) => pageBounds(diagramNodeId('diagram', 'flow', 0, id))
		expect(box('api').maxX).toBeLessThan(box('queue').minX)
		expect(box('queue').maxX).toBeLessThan(box('worker').minX)
		expect(box('worker').maxX).toBeLessThan(box('db').minX)
		const frameBounds = pageBounds(frame('diagram', 'flow', 0).id)
		for (const id of ['api', 'queue', 'worker', 'db'])
			expect(frameBounds.contains(box(id))).toBe(true)
	})

	it('leaves the shapes movable and selectable, and moving the frame moves its diagram', async () => {
		await renderDiagram(direct)
		const apiId = diagramNodeId('diagram', 'flow', 0, 'api')
		expect(geo(apiId).isLocked).toBe(false)
		editor.select(apiId)
		expect(editor.getSelectedShapeIds()).toEqual([apiId])

		const before = pageBounds(apiId)
		const frameShape = frame('diagram', 'flow', 0)
		editor.updateShape({ id: frameShape.id, type: 'frame', x: frameShape.x + 500 })
		expect(pageBounds(apiId).x).toBe(before.x + 500)
	})

	it('draws nothing highlighted for a lone diagram', async () => {
		await renderDiagram(queued)
		for (const node of queued.nodes) {
			expect(geo(diagramNodeId('diagram', 'flow', 0, node.id)).props.color).not.toBe(
				DIFFERENCE_COLOR,
			)
		}
	})

	it('updates in place when rendered again with the same id, keeping the frame where it is', async () => {
		await renderDiagram(queued)
		const frameShape = frame('diagram', 'flow', 0)
		editor.updateShape({ id: frameShape.id, type: 'frame', x: 4000, y: 3000 })
		const shapesBefore = editor.getCurrentPageShapeIds().size

		const result = await renderDiagram({
			nodes: queued.nodes.filter((n) => n.id !== 'worker'),
			edges: [
				{ from: 'api', to: 'queue' },
				{ from: 'queue', to: 'db' },
			],
		})

		expect(result.nodes).toEqual({ created: 0, updated: 3, removed: 1 })
		expect(result.edges).toEqual({ created: 1, updated: 1, removed: 2 })
		expect(editor.getCurrentPageShapeIds().size).toBe(shapesBefore - 2)
		// The layout origin is remembered: the frame goes back to its laid-out place, not to the drag.
		expect(frame('diagram', 'flow', 0).x).toBe(frameShape.x)
	})

	it('keeps several diagrams apart by id and never touches the frontier graph', async () => {
		await createCommandHandlers(editor)['graph.render']({
			nodes: [{ id: 'flow', title: 'Data flow', status: 'open' }],
			edges: [],
			frontier: ['flow'],
		})
		await renderDiagram(direct, 'one')
		await renderDiagram(queued, 'two')

		expect(editor.getShape(nodeShapeId('flow'))).toBeDefined()
		const one = pageBounds(frame('diagram', 'one', 0).id)
		const two = pageBounds(frame('diagram', 'two', 0).id)
		const graph = pageBounds(nodeShapeId('flow'))
		// New diagrams go to the right of what is on the page.
		expect(one.minX).toBeGreaterThan(graph.maxX)
		expect(two.minX).toBeGreaterThan(one.maxX)
	})
})

describe('diagram.render (compare)', () => {
	it('puts every alternative in its own frame, side by side, titled with its label', async () => {
		const result = await renderComparison([direct, queued])
		expect(result.frameIds).toHaveLength(2)
		const a = pageBounds(frame('comparison', 'ingest', 0).id)
		const b = pageBounds(frame('comparison', 'ingest', 1).id)
		expect(frame('comparison', 'ingest', 0).props.name).toBe('Direct')
		expect(frame('comparison', 'ingest', 1).props.name).toBe('Queued')
		expect(a.maxX).toBeLessThan(b.minX)
		expect(a.y).toBe(b.y)
		expect([a.w, a.h]).toEqual([b.w, b.h])
	})

	it('highlights exactly the nodes and edges that differ, in colour', async () => {
		await renderComparison([direct, queued])
		const color = (index: number, id: string) =>
			geo(diagramNodeId('comparison', 'ingest', index, id)).props.color
		const edgeColor = (index: number, edge: { from: string; to: string }) =>
			editor.getShape<TLArrowShape>(diagramEdgeId('comparison', 'ingest', index, edge))?.props.color

		expect(color(1, 'queue')).toBe(DIFFERENCE_COLOR)
		expect(color(1, 'worker')).toBe(DIFFERENCE_COLOR)
		expect(color(0, 'api')).not.toBe(DIFFERENCE_COLOR)
		expect(color(1, 'api')).not.toBe(DIFFERENCE_COLOR)
		expect(color(0, 'db')).not.toBe(DIFFERENCE_COLOR)
		expect(edgeColor(0, { from: 'api', to: 'db' })).toBe(DIFFERENCE_COLOR)
		expect(edgeColor(1, { from: 'api', to: 'queue' })).toBe(DIFFERENCE_COLOR)
	})

	it('shares one layout, so common nodes sit in the same place in every frame', async () => {
		await renderComparison([direct, queued])
		const offset = (index: number, id: string) => {
			const node = pageBounds(diagramNodeId('comparison', 'ingest', index, id))
			const frameBounds = pageBounds(frame('comparison', 'ingest', index).id)
			return { x: node.x - frameBounds.x, y: node.y - frameBounds.y }
		}
		expect(offset(0, 'api')).toEqual(offset(1, 'api'))
		expect(offset(0, 'db')).toEqual(offset(1, 'db'))
	})

	it('shows the caption and the colour legend in each frame', async () => {
		await renderComparison([direct, queued])
		const texts = editor
			.getSortedChildIdsForParent(frame('comparison', 'ingest', 1).id)
			.map((id) => editor.getShape(id))
			.filter((shape) => shape?.type === 'text')
			.map((shape) => JSON.stringify(shape?.props))
		expect(texts).toHaveLength(1)
		expect(texts[0]).toContain('Alternative 2')
		expect(texts[0]).toContain('Orange')
	})

	it('drops the frame of an alternative left out of a later call', async () => {
		await renderComparison([direct, queued, direct])
		expect(editor.getShape(diagramFrameId('comparison', 'ingest', 2))).toBeDefined()
		await renderComparison([direct, queued])
		expect(editor.getShape(diagramFrameId('comparison', 'ingest', 2))).toBeUndefined()
		expect(editor.getShape(diagramNodeId('comparison', 'ingest', 2, 'api'))).toBeUndefined()
	})

	it('is one undo step', async () => {
		editor.markHistoryStoppingPoint()
		await renderComparison([direct, queued])
		editor.undo()
		expect(editor.getCurrentPageShapeIds().size).toBe(0)
	})

	it('gets its question card right below the frames', async () => {
		await createCommandHandlers(editor)['graph.render']({
			nodes: [{ id: 'flow', title: 'Data flow', status: 'open' }],
			edges: [],
			frontier: ['flow'],
		})
		await renderComparison([direct, queued])
		await handlers()['ask.show']({
			askId: 'q1',
			question: 'Which data flow?',
			options: ['Direct', 'Queued'],
			recommendation: 1,
			comparison: 'ingest',
		})
		const card = pageBounds(questionCardId('q1'))
		const frames = editor.getShapesPageBounds([
			diagramFrameId('comparison', 'ingest', 0),
			diagramFrameId('comparison', 'ingest', 1),
		])
		expect(card.minY).toBeGreaterThan(frames?.maxY ?? Number.POSITIVE_INFINITY)
		expect(Math.abs(card.center.x - (frames?.center.x ?? 0))).toBeLessThan(1)
	})
})

describe('canvas.read of diagrams', () => {
	it('names diagram shapes and anchors an annotation to the alternative it is on', async () => {
		await renderComparison([direct, queued])
		const queue = pageBounds(diagramNodeId('comparison', 'ingest', 1, 'queue'))
		editor.createShape<TLNoteShape>({
			id: createShapeId('feedback'),
			type: 'note',
			x: queue.x + 10,
			y: queue.y + 10,
			props: { richText: toRichText('Too slow?') },
		})

		const read = await createCommandHandlers(editor, {
			capture: async () => {
				throw new Error('no screenshots here')
			},
		})['canvas.read']({ region: 'all', screenshot: false })

		const note = read.shapes.find((s) => s.role === 'sticky_note')
		expect(note?.owner).toBe('user')
		expect(note?.anchor).toMatchObject({
			role: 'diagram_node',
			relation: 'on',
			label: 'Queue',
			shapeId: diagramNodeId('comparison', 'ingest', 1, 'queue'),
		})
		const node = read.shapes.find((s) => s.id === diagramNodeId('comparison', 'ingest', 1, 'queue'))
		expect(node).toMatchObject({
			role: 'diagram_node',
			owner: 'claude',
			diagram: {
				kind: 'comparison',
				id: 'ingest',
				frame: 'Queued',
				element: 'queue',
				differs: true,
			},
		})
		const frameShape = read.shapes.find((s) => s.role === 'diagram_frame' && s.text === 'Direct')
		expect(frameShape?.owner).toBe('claude')
		const edge = read.shapes.find((s) => s.role === 'diagram_edge')
		expect(edge?.diagram?.element).toMatch(/->/)
		expect(edgeKey({ from: 'api', to: 'db' })).toBe('api->db')
	})
})
