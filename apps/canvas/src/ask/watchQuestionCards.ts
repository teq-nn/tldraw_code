import type { AskAnswer } from '@tldraw-code/protocol'
import {
	Box,
	type Editor,
	renderPlaintextFromRichText,
	type TLNoteShape,
	type TLShapeId,
} from 'tldraw'
import { agentNoteMeta } from '../note/renderNote'
import { answerQuestionCard, type QuestionCardShape } from './QuestionCardShapeUtil'
import { getQuestionCards, isQuestionCard } from './showQuestion'

/** How close (in page units) a sticky note must be to the card to count as an answer. */
export const NOTE_REACH = 160

export type AnswerListener = (askId: string, answer: AskAnswer) => void

/** The answer recorded on a card, or undefined while it waits. */
export function answerOf(card: QuestionCardShape): AskAnswer | undefined {
	const { answerKind, answerOption, answerText } = card.props
	switch (answerKind) {
		case 'option':
			return { kind: 'option', option: answerOption }
		case 'keep_grilling':
			return { kind: 'keep_grilling' }
		case 'note':
			return { kind: 'note', text: answerText }
		case 'none':
			return undefined
	}
}

/** Answers of the cards on the page, to re-send after the bridge reconnects. */
export function answeredQuestionCards(editor: Editor): { askId: string; answer: AskAnswer }[] {
	return getQuestionCards(editor).flatMap((card) => {
		const answer = answerOf(card)
		return answer ? [{ askId: card.props.askId, answer }] : []
	})
}

/**
 * Watch the canvas for answers to the waiting question card and report each
 * one once (ADR 0007):
 *
 * - a click on an option or "Keep grilling" (recorded in the card's props);
 * - a sticky note created while the card waits, once it has text, is no
 *   longer being edited and lies within {@link NOTE_REACH} of the card. Its
 *   text becomes the answer.
 *
 * Returns a function that stops watching.
 */
export function watchQuestionCards(editor: Editor, onAnswer: AnswerListener): () => void {
	/** Notes created while a card was waiting; each may still become an answer. */
	const candidates = new Set<TLShapeId>()

	const checkNotes = () => {
		if (candidates.size === 0) return
		const card = getQuestionCards(editor).find((c) => c.props.answerKind === 'none')
		if (!card) {
			candidates.clear()
			return
		}
		const reach = editor.getShapePageBounds(card.id)?.clone().expandBy(NOTE_REACH)
		for (const id of candidates) {
			const note = editor.getShape<TLNoteShape>(id)
			if (!note) {
				candidates.delete(id)
				continue
			}
			if (editor.getEditingShapeId() === id) continue
			const text = renderPlaintextFromRichText(editor, note.props.richText).trim()
			const bounds = editor.getShapePageBounds(id)
			if (!text || !reach || !bounds || !Box.Collides(reach, bounds)) continue
			candidates.clear()
			answerQuestionCard(editor, card, { answerKind: 'note', answerText: text.slice(0, 2000) })
			return
		}
	}

	const cleanups = [
		editor.sideEffects.registerAfterCreateHandler('shape', (shape) => {
			// Claude's own notes (ADR 0025) never answer a question.
			if (shape.type !== 'note' || agentNoteMeta(shape.meta)) return
			if (getQuestionCards(editor).some((c) => c.props.answerKind === 'none')) {
				candidates.add(shape.id)
				checkNotes()
			}
		}),
		editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
			if (isQuestionCard(next) && isQuestionCard(prev)) {
				const answer = answerOf(next)
				if (answer && prev.props.answerKind === 'none') onAnswer(next.props.askId, answer)
				return
			}
			if (next.type === 'note' && candidates.has(next.id)) checkNotes()
		}),
		// Editing a note ends: its text is final now.
		editor.sideEffects.registerAfterChangeHandler('instance_page_state', (prev, next) => {
			if (prev.editingShapeId !== next.editingShapeId) checkNotes()
		}),
	]
	return () => {
		for (const cleanup of cleanups) cleanup()
	}
}
