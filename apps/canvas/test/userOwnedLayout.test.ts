// @vitest-environment jsdom
import { type CanvasShape, computeFrontier, type FrontierGraph } from '@tldraw-code/protocol'
import {
	Box,
	createShapeId,
	type Editor,
	type TLNoteShape,
	type TLShapeId,
	toRichText,
} from 'tldraw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runScene } from '../bench/runScene'
import { SCENE, SCENE_WITH_TIDY } from '../bench/scene'
import { scoreRun } from '../bench/scorecard'
import { BASELINE_FLAVOUR, findLayoutFlavour } from '../src/bridge/layoutFlavours'
import { nodeShapeId } from '../src/graph/renderGraph'
import { ANCHOR_REACH } from '../src/perception/readCanvas'
import { createTestEditor } from './createTestEditor'

// Layout flavour F2 "user-owned space" (issue #28): once placed, a node is never moved.

let editor: Editor

beforeEach(() => {
	editor = createTestEditor()
	editor.updateViewportScreenBounds(new Box(0, 0, 1440, 900))
})

afterEach(() => editor.dispose())

// a -> b -> c, a -> d
const graph: FrontierGraph = {
	nodes: [
		{ id: 'a', title: 'Hosting', status: 'resolved', note: 'Managed Postgres' },
		{ id: 'b', title: 'Schema', status: 'open' },
		{ id: 'c', title: 'Write API', status: 'open' },
		{ id: 'd', title: 'Sign-in', status: 'open' },
	],
	edges: [
		{ from: 'a', to: 'b' },
		{ from: 'b', to: 'c' },
		{ from: 'a', to: 'd' },
	],
}

function userOwned() {
	const flavour = findLayoutFlavour('user-owned')
	if (!flavour) throw new Error('the user-owned flavour is not registered')
	return flavour
}

function render(g: FrontierGraph, flavour = userOwned(), options: { tidy?: boolean } = {}) {
	return flavour
		.createHandlers(editor)
		['graph.render']({ ...g, frontier: computeFrontier(g), ...options })
}

/** Drag a node as the user would. */
function drag(nodeId: string, dx: number, dy: number) {
	const shape = editor.getShape(nodeShapeId(nodeId))
	if (!shape) throw new Error(`no shape for node ${nodeId}`)
	editor.updateShape({ id: shape.id, type: shape.type, x: shape.x + dx, y: shape.y + dy })
}

function boundsOf(nodeId: string): Box {
	const bounds = editor.getShapePageBounds(nodeShapeId(nodeId))
	if (!bounds) throw new Error(`no shape for node ${nodeId}`)
	return bounds
}

function positionOf(nodeId: string) {
	const { x, y } = boundsOf(nodeId)
	return { x, y }
}

describe('the user-owned layout flavour', () => {
	it('is registered next to the baseline, which stays the default', () => {
		expect(userOwned().name).toBe('user-owned')
		expect(findLayoutFlavour('baseline')).toBe(BASELINE_FLAVOUR)
	})

	it('lays a new graph out as the baseline does', async () => {
		await render(graph)
		const f2 = graph.nodes.map((node) => positionOf(node.id))

		editor.deleteShapes([...editor.getCurrentPageShapeIds()])
		await render(graph, BASELINE_FLAVOUR)

		expect(graph.nodes.map((node) => positionOf(node.id))).toEqual(f2)
	})

	it('keeps every node where it is on a re-render, including one the user dragged', async () => {
		await render(graph)
		const dragged = editor.getShape(nodeShapeId('b'))
		if (!dragged) throw new Error('no shape for node b')
		editor.updateShape({
			id: dragged.id,
			type: dragged.type,
			x: dragged.x + 30,
			y: dragged.y + 400,
		})
		const before = graph.nodes.map((node) => positionOf(node.id))

		await render({
			...graph,
			nodes: graph.nodes.map((node) =>
				node.id === 'd' ? { ...node, status: 'resolved', note: 'OAuth' } : node,
			),
		})

		expect(graph.nodes.map((node) => positionOf(node.id))).toEqual(before)
	})

	it('puts a new node in the rank slot right of its blocker', async () => {
		await render(graph)

		await render(withNode('e', 'Audit log', 'c'))

		const blocker = boundsOf('c')
		const added = boundsOf('e')
		expect(added.minX).toBeGreaterThan(blocker.maxX)
		expect(added.minX - blocker.maxX).toBeLessThanOrEqual(120)
		expect(added.center.y).toBeCloseTo(blocker.center.y, 0)
		expectClearOfEverything('e')
	})

	it('moves a new node up or down its column when the rank slot is taken', async () => {
		await render(graph)
		const blocker = boundsOf('c')
		// The user drags d right into the slot beside c.
		const d = editor.getShape(nodeShapeId('d'))
		if (!d) throw new Error('no shape for node d')
		editor.updateShape({ id: d.id, type: d.type, x: blocker.maxX + 90, y: blocker.y })

		await render(withNode('e', 'Audit log', 'c'))

		const added = boundsOf('e')
		expect(added.minX).toBe(blocker.maxX + 90)
		expectClearOfEverything('e')
	})

	it('keeps new nodes beyond anchor reach of the user notes', async () => {
		await render(graph)
		const blocker = boundsOf('c')
		const note = createShapeId('user-note')
		editor.createShape<TLNoteShape>({
			id: note,
			type: 'note',
			x: blocker.maxX + 150,
			y: blocker.y,
			props: { richText: toRichText('Versioned?') },
		})

		await render(withNode('e', 'Audit log', 'c'))

		const noteBounds = editor.getShapePageBounds(note)
		if (!noteBounds) throw new Error('no note')
		expect(Box.Collides(Box.ExpandBy(boundsOf('e'), ANCHOR_REACH), noteBounds)).toBe(false)
	})

	it('places a new blocker of drawn nodes left of them', async () => {
		await render(graph)
		const g = withNode('z', 'Budget', undefined)

		await render({ ...g, edges: [...g.edges, { from: 'z', to: 'a' }] })

		expect(boundsOf('z').maxX).toBeLessThan(boundsOf('a').minX)
		expectClearOfEverything('z')
	})

	it('leaves the gap of a node that left the graph', async () => {
		await render(graph)
		const before = ['a', 'b', 'c'].map(positionOf)

		await render({
			nodes: graph.nodes.filter((node) => node.id !== 'd'),
			edges: graph.edges.filter((edge) => edge.to !== 'd'),
		})

		expect(editor.getShape(nodeShapeId('d'))).toBeUndefined()
		expect(['a', 'b', 'c'].map(positionOf)).toEqual(before)
	})

	it('lays a new graph out clear of what is already on the page', async () => {
		const center = editor.getViewportPageBounds().center
		const note = createShapeId('user-note')
		editor.createShape<TLNoteShape>({
			id: note,
			type: 'note',
			x: center.x - 100,
			y: center.y - 100,
		})

		await render(graph)

		for (const node of graph.nodes) expectClearOfEverything(node.id)
	})
})

describe('a tidy under the user-owned flavour', () => {
	it('lays the whole graph out afresh where it is, as the baseline would', async () => {
		await render(graph, BASELINE_FLAVOUR)
		await render(withNode('e', 'Audit log', 'c'), BASELINE_FLAVOUR)
		const baseline = ['a', 'b', 'c', 'd', 'e'].map(positionOf)
		editor.deleteShapes([...editor.getCurrentPageShapeIds()])

		await render(graph)
		drag('b', 30, 400)
		await render(withNode('e', 'Audit log', 'c'))
		await render(withNode('e', 'Audit log', 'c'), userOwned(), { tidy: true })

		expect(['a', 'b', 'c', 'd', 'e'].map(positionOf)).toEqual(baseline)
	})

	it('moves the user notes anchored to a node with it, so they keep their anchor', async () => {
		await render(graph)
		drag('b', 30, 400)
		const b = boundsOf('b')
		const on = stickNote('note-on-b', b.x + 40, b.y + 20)
		const beside = stickNote('note-beside-b', b.maxX + 60, b.y)
		const far = stickNote('note-far-away', b.x - 2000, b.y + 2000)
		const anchorsBefore = await anchorsOf([on, beside, far])
		const farBefore = editor.getShapePageBounds(far)

		await render(graph, userOwned(), { tidy: true })

		const moved = { x: boundsOf('b').x - b.x, y: boundsOf('b').y - b.y }
		expect(moved).not.toEqual({ x: 0, y: 0 })
		expect(editor.getShapePageBounds(on)?.x).toBe(b.x + 40 + moved.x)
		expect(editor.getShapePageBounds(on)?.y).toBe(b.y + 20 + moved.y)
		// Right of b, where c now is, it would annotate c: it stops short, near where b's move took it.
		const besideNow = editor.getShapePageBounds(beside)
		expect(besideNow?.x).toBeLessThan(b.maxX + 60 + moved.x)
		expect(besideNow?.x).toBeGreaterThan(boundsOf('b').x)
		expect(Math.abs((besideNow?.y ?? 0) - (b.y + moved.y))).toBeLessThanOrEqual(ANCHOR_REACH)
		expect(editor.getShapePageBounds(far)).toEqual(farBefore)
		expect(await anchorsOf([on, beside, far])).toEqual(anchorsBefore)
		expect(anchorsBefore.slice(0, 2)).toEqual([nodeShapeId('b'), nodeShapeId('b')])
	})

	it.each(['baseline', 'anchored'])(
		'is a plain render under the %s flavour, which lays the whole graph out every time',
		async (name) => {
			const flavour = findLayoutFlavour(name)
			if (!flavour) throw new Error(`the ${name} flavour is not registered`)
			await render(graph, flavour)
			const note = stickNote('note-on-b', boundsOf('b').x + 40, boundsOf('b').y + 20)
			await render(withNode('e', 'Audit log', 'c'), flavour)
			const plain = [...['a', 'b', 'c', 'd', 'e'].map(positionOf), editor.getShapePageBounds(note)]

			await render(withNode('e', 'Audit log', 'c'), flavour, { tidy: true })

			expect([
				...['a', 'b', 'c', 'd', 'e'].map(positionOf),
				editor.getShapePageBounds(note),
			]).toEqual(plain)
		},
	)
})

function stickNote(name: string, x: number, y: number): TLShapeId {
	const id = createShapeId(name)
	editor.createShape<TLNoteShape>({ id, type: 'note', x, y, props: { richText: toRichText(name) } })
	return id
}

/** The shape each of `ids` is anchored to, as `read_canvas` reports it (ADR 0008). */
async function anchorsOf(ids: TLShapeId[]) {
	const read = await userOwned()
		.createHandlers(editor, {
			capture: async () => {
				throw new Error('no screenshots in this test')
			},
		})
		['canvas.read']({ region: 'all', screenshot: false })
	return ids.map((id) => read.shapes.find((shape) => shape.id === id)?.anchor?.shapeId ?? null)
}

describe('question cards under the user-owned flavour', () => {
	const ask = {
		askId: 'ask-c',
		question: 'Which API?',
		options: ['REST', 'RPC'],
		recommendation: 0,
	}

	it('puts a new card clear of the user notes, beyond anchor reach', async () => {
		await render(graph)
		// Where the baseline puts the card: below the graph, centred.
		const below = Box.Common(graph.nodes.map((node) => boundsOf(node.id)))
		const note = createShapeId('user-note')
		editor.createShape<TLNoteShape>({
			id: note,
			type: 'note',
			x: below.center.x,
			y: below.maxY + 80,
		})

		const { shapeId } = await userOwned().createHandlers(editor)['ask.show'](ask)

		const card = editor.getShapePageBounds(shapeId as TLShapeId)
		const noteBounds = editor.getShapePageBounds(note)
		if (!card || !noteBounds) throw new Error('no card or note')
		expect(Box.Collides(Box.ExpandBy(card, ANCHOR_REACH), noteBounds)).toBe(false)
	})

	it('leaves a card that is already open where it is', async () => {
		await render(graph)
		const handlers = userOwned().createHandlers(editor)
		const { shapeId } = await handlers['ask.show'](ask)
		const card = editor.getShape(shapeId as TLShapeId)
		if (!card) throw new Error('no card')
		editor.updateShape({ id: card.id, type: card.type, x: card.x + 500 })
		const before = editor.getShapePageBounds(card.id)

		await handlers['ask.show'](ask)

		expect(editor.getShapePageBounds(card.id)).toEqual(before)
	})
})

function withNode(id: string, title: string, blocker: string | undefined): FrontierGraph {
	return {
		nodes: [...graph.nodes, { id, title, status: 'open' }],
		edges: blocker ? [...graph.edges, { from: blocker, to: id }] : graph.edges,
	}
}

/** The node overlaps no other shape on the page but arrows. */
function expectClearOfEverything(nodeId: string) {
	const bounds = boundsOf(nodeId)
	const hits = editor
		.getCurrentPageShapes()
		.filter((shape) => shape.id !== nodeShapeId(nodeId) && shape.type !== 'arrow')
		.filter((shape) => {
			const other = editor.getShapePageBounds(shape.id)
			return other !== undefined && Box.Collides(bounds, other)
		})
	expect(hits.map((shape) => shape.id)).toEqual([])
}

describe('the user-owned flavour on the layout benchmark', () => {
	it('moves no persisting node and no user shape, keeps every anchor and overlaps nothing', async () => {
		const run = await runScene(userOwned(), SCENE)
		const card = scoreRun(run, SCENE)

		const moved = run.steps.slice(1).flatMap((step, index) => {
			// Step 2 is the user's own: their drags are theirs to make.
			if (step.name === 'user') return []
			const before = nodePositions(run.steps[index]?.shapes ?? [])
			return [...nodePositions(step.shapes)].flatMap(([id, at]) => {
				const was = before.get(id)
				return was && (was.x !== at.x || was.y !== at.y) ? [`${step.name}: ${id}`] : []
			})
		})
		expect(moved).toEqual([])
		expect(card.aggregate.userShapesMoved).toBe(0)
		expect(card.aggregate.anchorsKept).toEqual({ kept: 4, total: 4 })
		expect(card.aggregate.claudeClaudeOverlaps).toBe(0)
		expect(card.aggregate.claudeUserOverlaps).toBe(0)
	})
})

describe('the user-owned flavour with a tidy on the layout benchmark', () => {
	it('tidies after step 7 to no more crossings than the baseline, keeping every anchor', async () => {
		const tidied = scoreRun(await runScene(userOwned(), SCENE_WITH_TIDY), SCENE_WITH_TIDY)
		const baseline = scoreRun(await runScene(BASELINE_FLAVOUR, SCENE), SCENE)

		expect(SCENE_WITH_TIDY.steps.map((step) => step.name)).toEqual([
			...SCENE.steps.slice(0, 7).map((step) => step.name),
			'tidy',
			...SCENE.steps.slice(7).map((step) => step.name),
		])
		const tidy = tidied.steps[7]?.graph?.crossings ?? 0
		expect(tidy).toBeGreaterThanOrEqual(baseline.steps[6]?.graph?.crossings ?? 1)
		expect(tidied.steps[7]?.anchorsKept).toEqual({ kept: 4, total: 4 })
		expect(tidied.aggregate.anchorsKept).toEqual({ kept: 4, total: 4 })
		expect(tidied.aggregate.claudeClaudeOverlaps).toBe(0)
	})
})

function nodePositions(shapes: CanvasShape[]): Map<string, { x: number; y: number }> {
	return new Map(
		shapes.flatMap((shape) =>
			shape.role === 'decision_node' && shape.decisionId
				? [[shape.decisionId, { x: shape.bounds.x, y: shape.bounds.y }] as const]
				: [],
		),
	)
}
