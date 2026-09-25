// @vitest-environment jsdom
import type { CanvasShape } from '@tldraw-code/protocol'
import {
	createShapeId,
	type Editor,
	renderPlaintextFromRichText,
	type TLNoteShape,
	type TLShapeId,
	toRichText,
} from 'tldraw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getQuestionCards } from '../src/ask/showQuestion'
import { watchQuestionCards } from '../src/ask/watchQuestionCards'
import { createCommandHandlers } from '../src/bridge/commandHandlers'
import { AGENT_NOTE_GAP, agentNoteShapeId } from '../src/note/renderNote'
import { ActivityTracker } from '../src/perception/activity'
import { createTestEditor } from './createTestEditor'

let editor: Editor
let activity: ActivityTracker
let handlers: ReturnType<typeof createCommandHandlers>

beforeEach(() => {
	editor = createTestEditor()
	activity = new ActivityTracker(editor)
	handlers = createCommandHandlers(editor, {
		activity,
		capture: async () => {
			throw new Error('no screenshots here')
		},
	})
})

afterEach(() => {
	activity.dispose()
	editor.dispose()
})

function addNote(text: string, x: number, y: number): TLShapeId {
	const id = createShapeId()
	editor.createShape<TLNoteShape>({ id, type: 'note', x, y, props: { richText: toRichText(text) } })
	return id
}

function pageBounds(id: TLShapeId) {
	const box = editor.getShapePageBounds(id)
	if (!box) throw new Error(`no shape ${id}`)
	return box
}

async function read(): Promise<CanvasShape[]> {
	return (await handlers['canvas.read']({ region: 'all', screenshot: false })).shapes
}

function note(id: TLShapeId): TLNoteShape {
	const shape = editor.getShape<TLNoteShape>(id)
	if (!shape) throw new Error(`no note ${id}`)
	return shape
}

describe('note.render', () => {
	it('puts a note on the canvas that does not look like the user’s sticky', async () => {
		const result = await handlers['note.render']({ text: 'Use the queue.' })
		expect(result.created).toBe(true)
		const shape = note(result.shapeId as TLShapeId)
		expect(shape.type).toBe('note')
		expect(shape.props.font).toBe('sans')
		expect(shape.props.color).not.toBe('yellow')
		expect(shape.props.color).not.toBe(editor.getShapeUtil('note').getDefaultProps().color)
		const plain = renderPlaintextFromRichText(editor, shape.props.richText)
		expect(plain).toContain('Claude')
		expect(plain).toContain('Use the queue.')
	})

	it('places a reply right of its target without overlap', async () => {
		const sticky = addNote('&agent which flow?', 100, 100)
		const result = await handlers['note.render']({ text: 'Queued.', replyTo: sticky })
		expect(result.replyToShapeId).toBe(sticky)
		const target = pageBounds(sticky)
		const reply = pageBounds(result.shapeId as TLShapeId)
		expect(reply.minX).toBeGreaterThanOrEqual(target.maxX + AGENT_NOTE_GAP)
		expect(reply.minY).toBe(target.minY)
	})

	it('moves a reply down past shapes already standing right of the target', async () => {
		const sticky = addNote('&agent which flow?', 100, 100)
		const first = await handlers['note.render']({ text: 'One.', replyTo: sticky })
		const second = await handlers['note.render']({ text: 'Two.', replyTo: sticky })
		const a = pageBounds(first.shapeId as TLShapeId)
		const b = pageBounds(second.shapeId as TLShapeId)
		expect(b.minX).toBe(a.minX)
		expect(b.minY).toBeGreaterThanOrEqual(a.maxY + AGENT_NOTE_GAP)
	})

	it('goes right of everything on the canvas without a replyTo', async () => {
		addNote('a', 0, 0)
		addNote('b', 300, 400)
		const result = await handlers['note.render']({ text: 'Hello.' })
		const content = editor.getCurrentPageBounds()
		expect(content).toBeDefined()
		expect(pageBounds(result.shapeId as TLShapeId).minX).toBeGreaterThan(500)
		expect(result.replyToShapeId).toBeUndefined()
	})

	it('updates the note with the same id in place', async () => {
		const first = await handlers['note.render']({ text: 'First.', id: 'answer' })
		expect(first.shapeId).toBe(agentNoteShapeId('answer'))
		const before = pageBounds(first.shapeId as TLShapeId)
		const second = await handlers['note.render']({ text: 'Second.', id: 'answer' })
		expect(second.created).toBe(false)
		expect(second.shapeId).toBe(first.shapeId)
		expect(pageBounds(second.shapeId as TLShapeId).x).toBe(before.x)
		const notes = editor.getCurrentPageShapes().filter((shape) => shape.type === 'note')
		expect(notes).toHaveLength(1)
		expect(
			renderPlaintextFromRichText(editor, note(second.shapeId as TLShapeId).props.richText),
		).toContain('Second.')
	})

	it('throws for a replyTo that is not a shape on the canvas', async () => {
		expect(() => handlers['note.render']({ text: 'x', replyTo: 'shape:nope' })).toThrow(
			/no shape "shape:nope"/i,
		)
		expect(() => handlers['note.render']({ text: 'x', replyTo: 'garbage' })).toThrow(
			/no shape "garbage"/i,
		)
		expect(editor.getCurrentPageShapes()).toHaveLength(0)
	})

	it('is listed under Claude’s shapes with the role agent_note, and without the label', async () => {
		addNote('mine', 0, 0)
		await handlers['note.render']({ text: 'Queued.' })
		const shapes = await read()
		const agent = shapes.find((shape) => shape.role === 'agent_note')
		expect(agent).toMatchObject({ owner: 'claude', text: 'Queued.' })
		expect(shapes.filter((shape) => shape.owner === 'user').map((s) => s.role)).toEqual([
			'sticky_note',
		])
	})

	it('is not user activity, and never an &agent invocation even if its text has the tag', async () => {
		activity.reset()
		await handlers['note.render']({ text: 'Ping &agent yourself?' })
		expect(activity.snapshot()).toEqual({ added: {}, changed: 0, removed: 0 })
		// Claude's note is also not counted as invoking when the user's own tag is handled.
		addNote('&agent hello', 0, 0)
		expect(activity.snapshot().invoked).toBe(1)
	})

	it('counts a deletion by the user as activity', async () => {
		const result = await handlers['note.render']({ text: 'Queued.' })
		activity.reset()
		editor.deleteShape(result.shapeId as TLShapeId)
		expect(activity.snapshot()).toMatchObject({ removed: 1 })
	})

	it('is never taken for the user’s note answer to a waiting question card', async () => {
		const answers: unknown[] = []
		const stop = watchQuestionCards(editor, (_askId, answer) => answers.push(answer))
		const card = await handlers['ask.show']({
			askId: 'q1',
			question: 'Which flow?',
			options: ['Direct', 'Queued'],
			recommendation: 1,
		})
		await handlers['note.render']({ text: 'Queued, I think.', replyTo: card.shapeId })
		stop()
		expect(answers).toEqual([])
		expect(getQuestionCards(editor)[0]?.props.answerKind).toBe('none')
	})
})
