import {
	Box,
	type Editor,
	renderPlaintextFromRichText,
	type TLNoteShape,
	type TLShapeId,
} from 'tldraw'
import { agentNoteMeta } from '../note/renderNote'
import type { QuestionCardShape } from './QuestionCardShapeUtil'
import { questionCardId } from './showQuestion'
import { NOTE_REACH } from './watchQuestionCards'

/**
 * Collapse the answered question card `askId` into the graph (ADR 0010):
 * remove the card and, for a sticky-note answer, the note that gave it; the
 * answer lives on as the note of a decision node. A card still waiting for an
 * answer stays. Returns whether the card was removed. Call inside the render's
 * `editor.run`, so render and collapse are one undo step.
 */
export function collapseAnsweredQuestion(editor: Editor, askId: string): boolean {
	const card = editor.getShape<QuestionCardShape>(questionCardId(askId))
	if (!card || card.props.answerKind === 'none') return false
	const answerNotes = card.props.answerKind === 'note' ? findAnswerNotes(editor, card) : []
	editor.deleteShapes([card.id, ...answerNotes])
	return true
}

/** The sticky notes next to the card whose text is the card's note answer (the watcher's rule). */
function findAnswerNotes(editor: Editor, card: QuestionCardShape): TLShapeId[] {
	const reach = editor.getShapePageBounds(card.id)?.clone().expandBy(NOTE_REACH)
	if (!reach) return []
	return editor
		.getCurrentPageShapes()
		.filter((shape): shape is TLNoteShape => shape.type === 'note' && !agentNoteMeta(shape.meta))
		.filter((note) => {
			const bounds = editor.getShapePageBounds(note.id)
			const text = renderPlaintextFromRichText(editor, note.props.richText).trim().slice(0, 2000)
			return bounds && Box.Collides(reach, bounds) && text === card.props.answerText
		})
		.map((note) => note.id)
}
