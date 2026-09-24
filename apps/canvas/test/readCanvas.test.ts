// @vitest-environment jsdom
import type { CanvasScreenshot } from '@tldraw-code/protocol'
import {
	type Box,
	createShapeId,
	type Editor,
	type TLGeoShape,
	type TLNoteShape,
	type TLShapeId,
	toRichText,
} from 'tldraw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { questionCardId } from '../src/ask/showQuestion'
import { createCommandHandlers } from '../src/bridge/commandHandlers'
import { nodeShapeId } from '../src/graph/renderGraph'
import { ActivityTracker } from '../src/perception/activity'
import { createTestEditor } from './createTestEditor'

// Perception through the command handlers, as the bridge calls them: Claude's
// commands draw, the test plays the user, `canvas.read` / `canvas.activity` report.

let editor: Editor
let activity: ActivityTracker
let capture: ReturnType<
	typeof vi.fn<(e: Editor, ids: TLShapeId[], b: Box) => Promise<CanvasScreenshot>>
>
let handlers: ReturnType<typeof createCommandHandlers>

const screenshot: CanvasScreenshot = { mimeType: 'image/png', data: 'AAAA', width: 10, height: 10 }

beforeEach(() => {
	editor = createTestEditor()
	activity = new ActivityTracker(editor)
	capture = vi.fn(async () => screenshot)
	handlers = createCommandHandlers(editor, { activity, capture })
})

afterEach(() => {
	activity.dispose()
	editor.dispose()
})

async function drawSession() {
	await handlers['graph.render']({
		nodes: [
			{ id: 'storage', title: 'Storage engine', status: 'open' },
			{ id: 'api', title: 'API style', status: 'blocked' },
		],
		edges: [{ from: 'storage', to: 'api' }],
		frontier: ['storage'],
	})
	await handlers['ask.show']({
		askId: 'q1',
		question: 'Which storage engine?',
		options: ['SQLite', 'Postgres'],
		recommendation: 0,
	})
}

function bounds(id: TLShapeId) {
	const box = editor.getShapePageBounds(id)
	if (!box) throw new Error(`no shape ${id}`)
	return box
}

function addNote(text: string, x: number, y: number): TLShapeId {
	const id = createShapeId()
	editor.createShape<TLNoteShape>({ id, type: 'note', x, y, props: { richText: toRichText(text) } })
	return id
}

function addSketch(x: number, y: number, w = 60, h = 40): TLShapeId {
	const id = createShapeId()
	editor.createShape<TLGeoShape>({
		id,
		type: 'geo',
		x,
		y,
		props: { geo: 'ellipse', w, h, color: 'red' },
	})
	return id
}

describe('canvas.read', () => {
	it('reports an empty page without a screenshot', async () => {
		const result = await handlers['canvas.read']({ region: 'all', screenshot: true })
		expect(result).toEqual({ region: null, shapes: [], omitted: 0, screenshot: null })
		expect(capture).not.toHaveBeenCalled()
	})

	it("describes Claude's shapes by their domain role", async () => {
		await drawSession()

		const { shapes } = await handlers['canvas.read']({ region: 'all', screenshot: false })

		const storage = shapes.find((s) => s.id === nodeShapeId('storage'))
		expect(storage).toMatchObject({
			role: 'decision_node',
			owner: 'claude',
			decisionId: 'storage',
			text: 'Storage engine',
			status: 'open',
			onFrontier: true,
		})
		expect(shapes.find((s) => s.id === nodeShapeId('api'))).toMatchObject({
			status: 'blocked',
			onFrontier: false,
		})
		expect(shapes.find((s) => s.role === 'dependency')).toMatchObject({
			decisionId: 'storage->api',
			fromShapeId: nodeShapeId('storage'),
			toShapeId: nodeShapeId('api'),
		})
		expect(shapes.find((s) => s.role === 'question_card')).toMatchObject({
			id: questionCardId('q1'),
			text: 'Which storage engine?',
			question: { options: ['SQLite', 'Postgres'], recommendation: 0 },
		})
	})

	it('links a sticky note next to the question card to that card', async () => {
		await drawSession()
		const card = bounds(questionCardId('q1'))
		const noteId = addNote('DuckDB, it is embedded', card.maxX + 40, card.y)

		const { shapes } = await handlers['canvas.read']({ region: 'question', screenshot: false })

		expect(shapes[0]).toMatchObject({
			id: noteId,
			role: 'sticky_note',
			owner: 'user',
			text: 'DuckDB, it is embedded',
			anchor: {
				shapeId: questionCardId('q1'),
				role: 'question_card',
				relation: 'next_to',
				label: 'Which storage engine?',
			},
		})
	})

	it('links a sketch on a decision node to that node, and leaves far-away shapes unlinked', async () => {
		await drawSession()
		const node = bounds(nodeShapeId('storage'))
		const onNode = addSketch(node.x + 10, node.y + 10)
		const farAway = addSketch(node.x + 5000, node.y + 5000)

		const { shapes } = await handlers['canvas.read']({ region: 'all', screenshot: false })

		expect(shapes.find((s) => s.id === onNode)?.anchor).toMatchObject({
			shapeId: nodeShapeId('storage'),
			relation: 'on',
			label: 'Storage engine',
		})
		expect(shapes.find((s) => s.id === onNode)).toMatchObject({ role: 'geo', geo: 'ellipse' })
		expect(shapes.find((s) => s.id === farAway)?.anchor).toBeUndefined()
	})

	it('links a user arrow to the decision node it points at', async () => {
		await drawSession()
		const arrowId = createShapeId()
		editor.createShape({ id: arrowId, type: 'arrow', x: 5000, y: 5000 })
		editor.createBindings([
			{
				type: 'arrow',
				fromId: arrowId,
				toId: nodeShapeId('api'),
				props: {
					terminal: 'end',
					normalizedAnchor: { x: 0.5, y: 0.5 },
					isExact: false,
					isPrecise: false,
				},
			},
		])

		const { shapes } = await handlers['canvas.read']({ region: 'all', screenshot: false })

		expect(shapes.find((s) => s.id === arrowId)).toMatchObject({
			role: 'arrow',
			owner: 'user',
			toShapeId: nodeShapeId('api'),
			anchor: { shapeId: nodeShapeId('api'), relation: 'on', label: 'API style' },
		})
	})

	it("counts shapes Claude's other tools drew (the smoke test) as Claude's", async () => {
		const { shapeId } = await handlers['smoke.create_shape']({ text: 'Hello' })
		const { shapes } = await handlers['canvas.read']({ region: 'all', screenshot: false })
		expect(shapes).toMatchObject([{ id: shapeId, role: 'geo', owner: 'claude', text: 'Hello' }])
	})

	it('reads only the shapes touching a page box', async () => {
		await drawSession()
		const node = bounds(nodeShapeId('storage'))

		const { region, shapes } = await handlers['canvas.read']({
			region: { x: node.x + 1, y: node.y + 1, w: 10, h: 10 },
			screenshot: false,
		})

		expect(region).toEqual({ x: Math.round(node.x + 1), y: Math.round(node.y + 1), w: 10, h: 10 })
		expect(shapes.map((s) => s.id)).toContain(nodeShapeId('storage'))
		expect(shapes.map((s) => s.id)).not.toContain(nodeShapeId('api'))
		expect(shapes.map((s) => s.id)).not.toContain(questionCardId('q1'))
	})

	it('fails the "question" region when there is no question card', async () => {
		await expect(handlers['canvas.read']({ region: 'question', screenshot: true })).rejects.toThrow(
			'no question card',
		)
	})

	it('captures a screenshot of the region with the top-level shapes in it', async () => {
		await drawSession()

		const result = await handlers['canvas.read']({ region: 'question', screenshot: true })

		expect(result.screenshot).toEqual(screenshot)
		expect(capture).toHaveBeenCalledOnce()
		const [, ids, box] = capture.mock.calls[0] ?? []
		expect(ids).toContain(questionCardId('q1'))
		expect(box?.w).toBe(result.region?.w)
	})

	it('reports why the screenshot is missing when capturing fails', async () => {
		await drawSession()
		capture.mockRejectedValueOnce(new Error('no canvas in jsdom'))

		const result = await handlers['canvas.read']({ region: 'all', screenshot: true })

		expect(result.screenshot).toBeNull()
		expect(result.screenshotError).toBe('no canvas in jsdom')
		expect(result.shapes.length).toBeGreaterThan(0)
	})
})

describe('canvas.activity', () => {
	it("counts the user's changes but not Claude's own commands", async () => {
		await drawSession()
		expect(handlers['canvas.activity']({})).toEqual({ added: {}, changed: 0, removed: 0 })

		addNote('Hmm', 2000, 2000)
		addNote('And this', 2400, 2000)
		addSketch(3000, 3000)
		editor.updateShape({ id: nodeShapeId('api'), type: 'geo', x: 999 })

		expect(handlers['canvas.activity']({})).toMatchObject({
			added: { sticky_note: 2, geo: 1 },
			removed: 0,
		})
		expect((await handlers['canvas.activity']({})).changed).toBeGreaterThanOrEqual(1)
	})

	it('is reset by a read', async () => {
		addNote('Hmm', 0, 0)
		await handlers['canvas.read']({ region: 'all', screenshot: false })
		expect(handlers['canvas.activity']({})).toEqual({ added: {}, changed: 0, removed: 0 })
	})

	it('forgets shapes added and deleted again, and counts deleting older ones', async () => {
		const old = addNote('old', 0, 0)
		await handlers['canvas.read']({ region: 'all', screenshot: false })
		const fresh = addNote('fresh', 500, 0)
		editor.deleteShapes([fresh, old])
		expect(handlers['canvas.activity']({})).toEqual({ added: {}, changed: 0, removed: 1 })
	})

	it('ignores question cards, whose answers reach Claude through ask', async () => {
		await drawSession()
		editor.updateShape({ id: questionCardId('q1'), type: 'question-card', x: 500 })
		expect(handlers['canvas.activity']({})).toEqual({ added: {}, changed: 0, removed: 0 })
	})
})
