import type { CanvasCommandPayload, CanvasCommandResult } from '@tldraw-code/protocol'
import { Box, createShapeId, type Editor, type TLShape, type TLShapeId } from 'tldraw'
import {
	estimateCardHeight,
	QUESTION_CARD_TYPE,
	QUESTION_CARD_WIDTH,
	type QuestionCardShape,
} from './QuestionCardShapeUtil'

type ShowPayload = CanvasCommandPayload<'ask.show'>
type ShowResult = CanvasCommandResult<'ask.show'>

/** Space between the frontier graph and the card placed below it. */
const GAP_BELOW_GRAPH = 60
const VIEW_INSET = 64

export function questionCardId(askId: string): TLShapeId {
	return createShapeId(`question-card:${askId}`)
}

export function isQuestionCard(shape: TLShape | undefined): shape is QuestionCardShape {
	return shape?.type === QUESTION_CARD_TYPE
}

export function getQuestionCards(editor: Editor): QuestionCardShape[] {
	return editor.getCurrentPageShapes().filter(isQuestionCard)
}

/**
 * Show the question card for `askId` (ADR 0006). Idempotent: an existing card
 * for the same askId is kept untouched, so re-asking after a timeout neither
 * resets nor duplicates it. Every other question card is removed first, so
 * only one is ever on the canvas. The card goes below the frontier graph if
 * there is one, else where the previous card was, else in the viewport centre.
 */
export function showQuestion(editor: Editor, payload: ShowPayload): ShowResult {
	const id = questionCardId(payload.askId)
	const others = getQuestionCards(editor).filter((card) => card.id !== id)
	let created = false

	editor.run(() => {
		editor.deleteShapes(others.map((card) => card.id))
		if (editor.getShape(id)) return
		const previous = others[0]
		const h = estimateCardHeight(payload.question, payload.options.length)
		const position = placeCard(editor, previous, h)
		editor.createShape<QuestionCardShape>({
			id,
			type: QUESTION_CARD_TYPE,
			x: position.x,
			y: position.y,
			props: {
				askId: payload.askId,
				question: payload.question,
				options: payload.options,
				recommendation: Math.min(payload.recommendation, payload.options.length - 1),
				w: QUESTION_CARD_WIDTH,
				h,
				answerKind: 'none',
				answerOption: -1,
				answerText: '',
			},
		})
		created = true
	})
	bringIntoView(editor, id)
	return { shapeId: id, created }
}

function placeCard(editor: Editor, previous: QuestionCardShape | undefined, h: number) {
	const graphIds = editor
		.getCurrentPageShapes()
		.filter((shape) => (shape.meta as { graphPart?: unknown }).graphPart === 'node')
		.map((shape) => shape.id)
	const graphBounds = graphIds.length > 0 ? editor.getShapesPageBounds(graphIds) : undefined
	if (graphBounds) {
		return {
			x: Math.round(graphBounds.center.x - QUESTION_CARD_WIDTH / 2),
			y: Math.round(graphBounds.maxY + GAP_BELOW_GRAPH),
		}
	}
	if (previous) return { x: previous.x, y: previous.y }
	const center = editor.getViewportPageBounds().center
	return { x: Math.round(center.x - QUESTION_CARD_WIDTH / 2), y: Math.round(center.y - h / 2) }
}

/** Pan (and zoom out if needed, never in beyond 100 %) so the card is fully visible. */
function bringIntoView(editor: Editor, id: TLShapeId): void {
	const bounds = editor.getShapePageBounds(id)
	if (!bounds) return
	// Keep a margin so the card is not hidden under the toolbar at the viewport edge.
	const target = Box.ExpandBy(bounds, VIEW_INSET)
	if (editor.getViewportPageBounds().contains(target)) return
	editor.zoomToBounds(target, { targetZoom: Math.min(1, editor.getZoomLevel()) })
}
