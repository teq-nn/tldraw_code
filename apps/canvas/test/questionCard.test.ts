// @vitest-environment jsdom
import type { AskAnswer } from '@tldraw-code/protocol'
import { createShapeId, type Editor, type TLGeoShape, type TLNoteShape, toRichText } from 'tldraw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	answerQuestionCard,
	QUESTION_CARD_TYPE,
	type QuestionCardShape,
} from '../src/ask/QuestionCardShapeUtil'
import { getQuestionCards, questionCardId, showQuestion } from '../src/ask/showQuestion'
import { answeredQuestionCards, watchQuestionCards } from '../src/ask/watchQuestionCards'
import { createCommandHandlers } from '../src/bridge/commandHandlers'
import { renderGraph } from '../src/graph/renderGraph'
import { createTestEditor } from './createTestEditor'

let editor: Editor
let answers: { askId: string; answer: AskAnswer }[]
let stopWatching: () => void

const payload = {
	askId: 'q1',
	question: 'Which storage engine?',
	options: ['SQLite', 'Postgres'],
	recommendation: 0,
}

beforeEach(() => {
	editor = createTestEditor()
	answers = []
	stopWatching = watchQuestionCards(editor, (askId, answer) => answers.push({ askId, answer }))
})

afterEach(() => {
	stopWatching()
	editor.dispose()
})

function card(askId = 'q1'): QuestionCardShape {
	const shape = editor.getShape<QuestionCardShape>(questionCardId(askId))
	if (!shape) throw new Error(`no card for ${askId}`)
	return shape
}

function addNote(text: string, x: number, y: number) {
	const id = createShapeId()
	editor.createShape<TLNoteShape>({ id, type: 'note', x, y, props: { richText: toRichText(text) } })
	return id
}

describe('ask.show', () => {
	it('creates a question card with the question, options and recommendation', async () => {
		const result = await createCommandHandlers(editor)['ask.show'](payload)

		expect(result).toEqual({ shapeId: questionCardId('q1'), created: true })
		expect(card().type).toBe(QUESTION_CARD_TYPE)
		expect(card().props).toMatchObject({
			question: 'Which storage engine?',
			options: ['SQLite', 'Postgres'],
			recommendation: 0,
			answerKind: 'none',
		})
		const bounds = editor.getShapePageBounds(card().id)
		expect(bounds && editor.getViewportPageBounds().contains(bounds)).toBe(true)
	})

	it('keeps an existing card for the same question, including its answer', () => {
		showQuestion(editor, payload)
		answerQuestionCard(editor, card(), { answerKind: 'option', answerOption: 1 })

		const again = showQuestion(editor, payload)

		expect(again.created).toBe(false)
		expect(getQuestionCards(editor)).toHaveLength(1)
		expect(card().props.answerOption).toBe(1)
	})

	it('keeps only one question card: a new question replaces the old card in place', () => {
		showQuestion(editor, payload)
		editor.updateShape({ id: card().id, type: QUESTION_CARD_TYPE, x: 1000, y: 500 })

		showQuestion(editor, { ...payload, askId: 'q2', question: 'Which ORM?' })

		const cards = getQuestionCards(editor)
		expect(cards.map((c) => c.props.askId)).toEqual(['q2'])
		expect(cards[0]).toMatchObject({ x: 1000, y: 500 })
	})

	it('places the card below the frontier graph', () => {
		renderGraph(editor, {
			nodes: [{ id: 'a', title: 'Storage', status: 'open' }],
			edges: [],
			frontier: ['a'],
		})
		const graph = editor.getShapePageBounds(createShapeId('graph-node:a'))

		showQuestion(editor, payload)

		const bounds = editor.getShapePageBounds(card().id)
		expect(graph && bounds && bounds.minY).toBeGreaterThan(graph?.maxY ?? Number.POSITIVE_INFINITY)
	})
})

describe('answers', () => {
	it('reports a click on an option once', () => {
		showQuestion(editor, payload)
		answerQuestionCard(editor, card(), { answerKind: 'option', answerOption: 1 })
		answerQuestionCard(editor, card(), { answerKind: 'option', answerOption: 0 })

		expect(answers).toEqual([{ askId: 'q1', answer: { kind: 'option', option: 1 } }])
		expect(card().props).toMatchObject({ answerKind: 'option', answerOption: 1 })
	})

	it('reports "Keep grilling"', () => {
		showQuestion(editor, payload)
		answerQuestionCard(editor, card(), { answerKind: 'keep_grilling' })
		expect(answers).toEqual([{ askId: 'q1', answer: { kind: 'keep_grilling' } }])
	})

	it('takes a sticky note stuck next to the waiting card as the answer', () => {
		showQuestion(editor, payload)
		const bounds = editor.getShapePageBounds(card().id)
		if (!bounds) throw new Error('no bounds')

		addNote('Plain JSON files', bounds.maxX + 20, bounds.minY)

		expect(answers).toEqual([{ askId: 'q1', answer: { kind: 'note', text: 'Plain JSON files' } }])
		expect(card().props).toMatchObject({ answerKind: 'note', answerText: 'Plain JSON files' })
	})

	it('waits until a note next to the card has text and is no longer edited', () => {
		showQuestion(editor, payload)
		const bounds = editor.getShapePageBounds(card().id)
		if (!bounds) throw new Error('no bounds')

		const id = addNote('', bounds.maxX + 20, bounds.minY)
		editor.setEditingShape(id)
		editor.updateShape<TLNoteShape>({ id, type: 'note', props: { richText: toRichText('Maybe') } })
		expect(answers).toHaveLength(0)

		editor.setEditingShape(null)
		expect(answers).toEqual([{ askId: 'q1', answer: { kind: 'note', text: 'Maybe' } }])
	})

	it('ignores notes far from the card until they are moved next to it', () => {
		showQuestion(editor, payload)
		const bounds = editor.getShapePageBounds(card().id)
		if (!bounds) throw new Error('no bounds')

		const id = addNote('Over here', bounds.maxX + 2000, bounds.minY)
		expect(answers).toHaveLength(0)

		editor.updateShape({ id, type: 'note', x: bounds.minX, y: bounds.maxY + 10 })
		expect(answers).toEqual([{ askId: 'q1', answer: { kind: 'note', text: 'Over here' } }])
	})

	it('ignores notes when no card is waiting', () => {
		showQuestion(editor, payload)
		answerQuestionCard(editor, card(), { answerKind: 'keep_grilling' })
		const bounds = editor.getShapePageBounds(card().id)
		if (!bounds) throw new Error('no bounds')

		addNote('Late note', bounds.maxX + 20, bounds.minY)

		expect(answers).toHaveLength(1)
		expect(card().props.answerKind).toBe('keep_grilling')
	})

	it('lists answered cards for re-sending after a reconnect', () => {
		showQuestion(editor, payload)
		expect(answeredQuestionCards(editor)).toEqual([])
		answerQuestionCard(editor, card(), { answerKind: 'option', answerOption: 0 })
		expect(answeredQuestionCards(editor)).toEqual([
			{ askId: 'q1', answer: { kind: 'option', option: 0 } },
		])
	})
})

// ADR 0010: the graph, with the answer as a node's note, replaces the answered card.
describe('collapsing into the graph', () => {
	const open = { nodes: [{ id: 'a', title: 'Storage', status: 'open' as const }], edges: [] }
	const resolved = {
		nodes: [{ id: 'a', title: 'Storage', status: 'resolved' as const, note: 'SQLite' }],
		edges: [],
	}

	it('removes the answered card named in the render and shows the note on the node', () => {
		renderGraph(editor, { ...open, frontier: ['a'] })
		showQuestion(editor, payload)
		answerQuestionCard(editor, card(), { answerKind: 'option', answerOption: 0 })

		const result = renderGraph(editor, { ...resolved, frontier: [], collapseQuestion: 'q1' })

		expect(result.questionCollapsed).toBe(true)
		expect(getQuestionCards(editor)).toEqual([])
		const node = editor.getShape<TLGeoShape>(createShapeId('graph-node:a'))
		expect(node && editor.getShapeUtil(node).getText(node)).toBe('Storage\nSQLite')
	})

	it('keeps a card that is still waiting for an answer', () => {
		showQuestion(editor, payload)
		const result = renderGraph(editor, { ...open, frontier: ['a'], collapseQuestion: 'q1' })
		expect(result.questionCollapsed).toBe(false)
		expect(getQuestionCards(editor)).toHaveLength(1)
	})

	it('leaves a card it is not told about alone', () => {
		showQuestion(editor, payload)
		answerQuestionCard(editor, card(), { answerKind: 'option', answerOption: 0 })
		const result = renderGraph(editor, { ...resolved, frontier: [], collapseQuestion: 'q9' })
		expect(result.questionCollapsed).toBe(false)
		expect(getQuestionCards(editor)).toHaveLength(1)
	})

	it('also removes the sticky note that answered it, and no other note', () => {
		const earlier = addNote('Whatever the team knows', -3000, -3000)
		showQuestion(editor, payload)
		const bounds = editor.getShapePageBounds(card().id)
		if (!bounds) throw new Error('no bounds')
		const answer = addNote('Whatever the team knows', bounds.maxX + 20, bounds.minY)
		expect(card().props).toMatchObject({
			answerKind: 'note',
			answerText: 'Whatever the team knows',
		})
		const nearby = addNote('Unrelated thought', bounds.minX, bounds.maxY + 20)

		renderGraph(editor, { ...resolved, frontier: [], collapseQuestion: 'q1' })

		expect(getQuestionCards(editor)).toEqual([])
		expect(editor.getShape(answer)).toBeUndefined()
		expect(editor.getShape(nearby)).toBeDefined()
		expect(editor.getShape(earlier)).toBeDefined()
	})

	it('brings the graph back into view', () => {
		renderGraph(editor, { ...open, frontier: ['a'] })
		showQuestion(editor, payload)
		answerQuestionCard(editor, card(), { answerKind: 'option', answerOption: 0 })
		editor.centerOnPoint({ x: 5000, y: 5000 })

		renderGraph(editor, { ...resolved, frontier: [], collapseQuestion: 'q1' })

		const node = editor.getShapePageBounds(createShapeId('graph-node:a'))
		expect(node && editor.getViewportPageBounds().contains(node)).toBe(true)
	})

	it('undoes together with the render', () => {
		renderGraph(editor, { ...open, frontier: ['a'] })
		showQuestion(editor, payload)
		answerQuestionCard(editor, card(), { answerKind: 'keep_grilling' })
		editor.markHistoryStoppingPoint()

		renderGraph(editor, { ...resolved, frontier: [], collapseQuestion: 'q1' })
		editor.undo()

		expect(getQuestionCards(editor)).toHaveLength(1)
	})
})
