// @vitest-environment jsdom
import {
	type CanvasCommandPayload,
	type DiagramSpec,
	diffAlternatives,
} from '@tldraw-code/protocol'
import {
	type Editor,
	kickoutOccludedShapes,
	renderPlaintextFromRichText,
	type TLArrowBinding,
	type TLFrameShape,
	type TLTextShape,
} from 'tldraw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { questionCardId } from '../src/ask/showQuestion'
import { createCommandHandlers } from '../src/bridge/commandHandlers'
import { choicePinId, hideCollapsedContent } from '../src/comparison/comparisonFrames'
import { REJECTED_OPACITY } from '../src/comparison/settleComparison'
import { diagramCaptionId, diagramFrameId, diagramNodeId } from '../src/diagram/renderDiagrams'
import { nodeShapeId } from '../src/graph/renderGraph'
import {
	PROTOTYPE_HEADER_HEIGHT,
	type PrototypeFrameShape,
} from '../src/prototype/PrototypeShapeUtil'
import { PROTOTYPE_GAP, prototypeShapeId } from '../src/prototype/renderPrototype'
import { createTestEditor } from './createTestEditor'

// Comparisons of prototypes (ADR 0020) and settling a comparison after the
// user chose (ADR 0021), against a headless editor.

let editor: Editor
let handlers: ReturnType<typeof createCommandHandlers>

beforeEach(() => {
	editor = createTestEditor()
	handlers = createCommandHandlers(editor, {
		capture: async () => {
			throw new Error('no screenshots here')
		},
	})
})

afterEach(() => editor.dispose())

const direct: DiagramSpec = {
	nodes: [
		{ id: 'api', label: 'API' },
		{ id: 'db', label: 'Database' },
	],
	edges: [{ from: 'api', to: 'db' }],
}
const queued: DiagramSpec = {
	nodes: [
		{ id: 'api', label: 'API' },
		{ id: 'queue', label: 'Queue' },
		{ id: 'db', label: 'Database' },
	],
	edges: [
		{ from: 'api', to: 'queue' },
		{ from: 'queue', to: 'db' },
	],
}

async function drawGraph(ids: string[]) {
	await handlers['graph.render']({
		nodes: ids.map((id) => ({ id, title: id, status: 'open' as const })),
		edges: [],
		frontier: ids,
	})
}

async function compareDiagrams(id = 'ingest') {
	const specs = [direct, queued]
	const diffs = diffAlternatives(specs)
	await handlers['diagram.render']({
		kind: 'comparison',
		id,
		frames: specs.map((spec, index) => ({
			title: ['Direct', 'Queued'][index] ?? '',
			caption: `Alternative ${index + 1}`,
			...spec,
			highlight: {
				nodes: diffs[index]?.nodes.map((d) => d.id) ?? [],
				edges: diffs[index]?.edges.map((d) => d.id) ?? [],
			},
		})),
	})
}

const html = (text: string) => `<!doctype html><html><body><p>${text}</p></body></html>`

async function comparePrototypes(id = 'login', labels = ['Tabs', 'Single form']) {
	for (const [index, label] of labels.entries()) {
		await handlers['prototype.render']({
			id: `${id}-${index}`,
			label,
			caption: `Variant ${index + 1}`,
			html: html(label),
			comparison: { id, index },
		})
	}
}

function settle(payload: Partial<CanvasCommandPayload<'comparison.settle'>> = {}) {
	return handlers['comparison.settle']({
		id: 'ingest',
		chosen: 'Queued',
		rejected: [{ label: 'Direct', reason: 'Writes block the request' }],
		node: 'ingest',
		...payload,
	})
}

function diagramFrame(index: number, id = 'ingest'): TLFrameShape {
	const shape = editor.getShape<TLFrameShape>(diagramFrameId('comparison', id, index))
	if (!shape) throw new Error(`no frame ${index}`)
	return shape
}

function prototype(id: string): PrototypeFrameShape {
	const shape = editor.getShape<PrototypeFrameShape>(prototypeShapeId(id))
	if (!shape) throw new Error(`no prototype ${id}`)
	return shape
}

function captionText(index: number): string {
	const caption = editor.getShape<TLTextShape>(diagramCaptionId('comparison', 'ingest', index))
	return caption ? renderPlaintextFromRichText(editor, caption.props.richText) : ''
}

function bounds(id: Parameters<Editor['getShapePageBounds']>[0]) {
	const box = editor.getShapePageBounds(id)
	if (!box) throw new Error(`no bounds for ${id}`)
	return box
}

function pinEnds(comparison: string) {
	const bindings = editor.getBindingsFromShape<TLArrowBinding>(choicePinId(comparison), 'arrow')
	const end = (terminal: string) => bindings.find((b) => b.props.terminal === terminal)?.toId
	return { start: end('start'), end: end('end') }
}

describe('prototype alternatives (compare with html items)', () => {
	it('puts the prototypes side by side, top-aligned, in their order', async () => {
		await drawGraph(['login'])
		await comparePrototypes()
		const first = bounds(prototypeShapeId('login-0'))
		const second = bounds(prototypeShapeId('login-1'))
		expect(first.minX).toBeGreaterThan(bounds(nodeShapeId('login')).maxX)
		expect(second.minX).toBe(first.maxX + PROTOTYPE_GAP)
		expect(second.minY).toBe(first.minY)
	})

	it('gets its question card right below the prototypes', async () => {
		await comparePrototypes()
		await handlers['ask.show']({
			askId: 'q1',
			question: 'Which login?',
			options: ['Tabs', 'Single form'],
			recommendation: 1,
			comparison: 'login',
		})
		const row = editor.getShapesPageBounds([
			prototypeShapeId('login-0'),
			prototypeShapeId('login-1'),
		])
		const card = bounds(questionCardId('q1'))
		expect(card.minY).toBeGreaterThan(row?.maxY ?? Number.POSITIVE_INFINITY)
		expect(Math.abs(card.center.x - (row?.center.x ?? 0))).toBeLessThan(2)
	})

	it('reports the comparison of each prototype in read_canvas', async () => {
		await comparePrototypes()
		const { shapes } = await handlers['canvas.read']({ region: 'all', screenshot: false })
		const found = shapes.find((shape) => shape.id === prototypeShapeId('login-1'))
		expect(found?.prototype).toMatchObject({ id: 'login-1', comparison: 'login' })
	})
})

describe('comparison.settle', () => {
	it('marks the chosen diagram, collapses and dims the rejected one with its reason, and pins the choice', async () => {
		await drawGraph(['ingest'])
		await compareDiagrams()
		const expandedH = diagramFrame(0).props.h

		const result = await settle()

		expect(diagramFrame(1)).toMatchObject({
			opacity: 1,
			props: { name: 'Queued (chosen)', color: 'green' },
		})
		const rejected = diagramFrame(0)
		expect(rejected.opacity).toBe(REJECTED_OPACITY)
		expect(rejected.props.name).toBe('Direct (rejected)')
		expect(rejected.props.h).toBeLessThan(expandedH)
		expect(captionText(0)).toBe('Rejected: Writes block the request')
		// Collapsed, not deleted: the alternative's diagram is still inside the frame.
		expect(editor.getSortedChildIdsForParent(rejected.id).length).toBeGreaterThan(1)
		expect(pinEnds('ingest')).toEqual({ start: nodeShapeId('ingest'), end: diagramFrame(1).id })
		expect(result).toEqual({
			kind: 'diagram',
			chosenFrameId: diagramFrame(1).id,
			rejectedFrameIds: [diagramFrame(0).id],
			pinId: choicePinId('ingest'),
		})
	})

	it('switches the choice when settled again, expanding the formerly rejected alternative', async () => {
		await drawGraph(['ingest'])
		await compareDiagrams()
		const expandedH = diagramFrame(0).props.h
		await settle()

		await settle({ chosen: 'Direct', rejected: [{ label: 'Queued', reason: 'One more service' }] })

		expect(diagramFrame(0)).toMatchObject({ opacity: 1, props: { h: expandedH, color: 'green' } })
		expect(captionText(0)).toContain('Alternative 1')
		expect(diagramFrame(1).opacity).toBe(REJECTED_OPACITY)
		expect(captionText(1)).toBe('Rejected: One more service')
		expect(pinEnds('ingest').end).toBe(diagramFrame(0).id)
		expect(
			editor.getCurrentPageShapes().filter((s) => s.id === choicePinId('ingest')),
		).toHaveLength(1)
	})

	it('is undone in one step', async () => {
		await drawGraph(['ingest'])
		await compareDiagrams()
		editor.markHistoryStoppingPoint()
		await settle()
		editor.undo()
		expect(diagramFrame(0).opacity).toBe(1)
		expect(editor.getShape(choicePinId('ingest'))).toBeUndefined()
	})

	it('collapses a rejected prototype to its title bar with the reason as its caption', async () => {
		await drawGraph(['login'])
		await comparePrototypes()
		const fullH = prototype('login-0').props.h

		const result = await settle({
			id: 'login',
			node: 'login',
			chosen: 'Single form',
			rejected: [{ label: 'Tabs', reason: 'Hides sign-up behind a tab' }],
		})

		expect(result.kind).toBe('prototype')
		expect(prototype('login-0')).toMatchObject({
			opacity: REJECTED_OPACITY,
			props: { h: PROTOTYPE_HEADER_HEIGHT, caption: 'Rejected: Hides sign-up behind a tab' },
			meta: { choice: 'rejected', expandedH: fullH, expandedCaption: 'Variant 1' },
		})
		expect(prototype('login-1')).toMatchObject({ opacity: 1, meta: { choice: 'chosen' } })
		expect(pinEnds('login')).toEqual({ start: nodeShapeId('login'), end: prototype('login-1').id })
	})

	it('re-opens a settled comparison when it is shown again', async () => {
		await drawGraph(['login'])
		await comparePrototypes()
		const fullH = prototype('login-0').props.h
		await settle({
			id: 'login',
			node: 'login',
			chosen: 'Single form',
			rejected: [{ label: 'Tabs', reason: 'Hides sign-up' }],
		})

		await comparePrototypes()

		expect(prototype('login-0')).toMatchObject({
			opacity: 1,
			props: { h: fullH, caption: 'Variant 1' },
			meta: { choice: '' },
		})
		expect(editor.getShape(choicePinId('login'))).toBeUndefined()

		await compareDiagrams()
		await settle()
		await compareDiagrams()
		expect(diagramFrame(0)).toMatchObject({ opacity: 1, props: { name: 'Direct' } })
		expect(editor.getShape(choicePinId('ingest'))).toBeUndefined()
	})

	it('settles without a pin when the decision node is not on the canvas', async () => {
		await compareDiagrams()
		const result = await settle({ node: 'nowhere' })
		expect(result.pinId).toBeNull()
		expect(diagramFrame(0).opacity).toBe(REJECTED_OPACITY)
	})

	it('removes the pin when its decision node leaves the graph', async () => {
		await drawGraph(['ingest', 'other'])
		await compareDiagrams()
		await settle()
		await drawGraph(['other'])
		expect(editor.getShape(choicePinId('ingest'))).toBeUndefined()
	})

	it.each([
		['an unknown comparison', { id: 'nope' }, /no comparison "nope"/],
		[
			'a chosen label that is not an alternative',
			{ chosen: 'Batched' },
			/"Batched" is not an alternative/,
		],
		[
			'a rejected label that is not an alternative',
			{ rejected: [{ label: 'Batched', reason: 'x' }] },
			/"Batched" is not a rejected alternative/,
		],
		[
			'the chosen alternative listed as rejected',
			{
				chosen: 'Queued',
				rejected: [{ label: 'Queued', reason: 'x' }],
			},
			/not a rejected alternative/,
		],
	])('refuses %s without changing anything', async (_name, payload, message) => {
		await drawGraph(['ingest'])
		await compareDiagrams()
		await expect(async () => settle(payload)).rejects.toThrow(message)
		expect(diagramFrame(0).opacity).toBe(1)
	})

	it('asks for a reason for every alternative that was not chosen', async () => {
		const specs = [direct, queued, direct]
		await handlers['diagram.render']({
			kind: 'comparison',
			id: 'ingest',
			frames: specs.map((spec, index) => ({
				title: ['Direct', 'Queued', 'Batched'][index] ?? '',
				...spec,
				highlight: { nodes: [], edges: [] },
			})),
		})
		await expect(async () => settle()).rejects.toThrow(/missing: "Batched"/)
	})

	it('shows the choice in read_canvas: chosen, rejected with the reason, and the pin', async () => {
		await drawGraph(['ingest'])
		await compareDiagrams()
		await settle()
		const { shapes } = await handlers['canvas.read']({ region: 'all', screenshot: false })
		const byId = (id: string) => shapes.find((shape) => shape.id === id)
		expect(byId(diagramFrame(1).id)?.choice).toEqual({ state: 'chosen' })
		expect(byId(diagramFrame(0).id)?.choice).toEqual({
			state: 'rejected',
			reason: 'Writes block the request',
		})
		expect(byId(choicePinId('ingest'))).toMatchObject({
			role: 'choice_pin',
			owner: 'claude',
			fromShapeId: nodeShapeId('ingest'),
			toShapeId: diagramFrame(1).id,
		})
	})
})

describe('on the live canvas', () => {
	it('hides the content of a collapsed diagram frame, all but the reason', async () => {
		editor.dispose()
		editor = createTestEditor({ getShapeVisibility: hideCollapsedContent })
		handlers = createCommandHandlers(editor)
		await drawGraph(['ingest'])
		await compareDiagrams()
		await settle()

		expect(editor.isShapeHidden(diagramNodeId('comparison', 'ingest', 0, 'api'))).toBe(true)
		expect(editor.isShapeHidden(diagramCaptionId('comparison', 'ingest', 0))).toBe(false)
		expect(editor.isShapeHidden(diagramNodeId('comparison', 'ingest', 1, 'api'))).toBe(false)

		await settle({ chosen: 'Direct', rejected: [{ label: 'Queued', reason: 'One more service' }] })
		expect(editor.isShapeHidden(diagramNodeId('comparison', 'ingest', 0, 'api'))).toBe(false)
	})

	it('keeps the content of a collapsed diagram frame inside, and hidden, when the user moves it', async () => {
		editor.dispose()
		editor = createTestEditor({ getShapeVisibility: hideCollapsedContent })
		handlers = createCommandHandlers(editor)
		await drawGraph(['ingest'])
		await compareDiagrams()
		await settle()
		const frameId = diagramFrameId('comparison', 'ingest', 0)
		const api = diagramNodeId('comparison', 'ingest', 0, 'api')

		// What the select tool does when a drag ends: move the frame, then kick
		// out children that no longer overlap it, which is all of them below the title bar.
		const frame = editor.getShape<TLFrameShape>(frameId)
		editor.updateShape<TLFrameShape>({ id: frameId, type: 'frame', x: (frame?.x ?? 0) + 40 })
		kickoutOccludedShapes(editor, [frameId])

		expect(editor.getShape(api)?.parentId).toBe(frameId)
		expect(editor.isShapeHidden(api)).toBe(true)

		// Expanded again, the content is where it was in the frame.
		await settle({ chosen: 'Direct', rejected: [{ label: 'Queued', reason: 'One more service' }] })
		expect(editor.isShapeHidden(api)).toBe(false)
	})

	it('does not take a shape dropped on a collapsed diagram frame in, where it would vanish', async () => {
		editor.dispose()
		editor = createTestEditor({ getShapeVisibility: hideCollapsedContent })
		handlers = createCommandHandlers(editor)
		await drawGraph(['ingest'])
		await compareDiagrams()
		await settle()
		const frame = editor.getShape<TLFrameShape>(diagramFrameId('comparison', 'ingest', 0))
		if (!frame) throw new Error('no frame')

		expect(editor.getShapeUtil(frame).canReceiveNewChildrenOfType(frame, 'note')).toBe(false)
		const chosen = editor.getShape<TLFrameShape>(diagramFrameId('comparison', 'ingest', 1))
		if (!chosen) throw new Error('no frame')
		expect(editor.getShapeUtil(chosen).canReceiveNewChildrenOfType(chosen, 'note')).toBe(true)
	})

	it('moves a growing graph left instead of into the comparison row to its right', async () => {
		await drawGraph(['a'])
		await compareDiagrams()
		const row = bounds(diagramFrameId('comparison', 'ingest', 0))
		// The graph grows: a chain of blockers in front of `a` pushes it to the right.
		await handlers['graph.render']({
			nodes: ['p', 'q', 'r', 'a'].map((id) => ({ id, title: id, status: 'open' as const })),
			edges: [
				{ from: 'p', to: 'q' },
				{ from: 'q', to: 'r' },
				{ from: 'r', to: 'a' },
			],
			frontier: ['p'],
		})
		const graph = editor.getShapesPageBounds(['p', 'q', 'r', 'a'].map((id) => nodeShapeId(id)))
		expect(graph?.maxX).toBeLessThan(row.minX)
		expect(bounds(diagramFrameId('comparison', 'ingest', 0))).toEqual(row)
	})
})
