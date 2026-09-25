import type { CanvasCommandPayload, CanvasCommandResult } from '@tldraw-code/protocol'
import {
	Box,
	createShapeId,
	type Editor,
	type JsonObject,
	type TLNoteShape,
	type TLRichText,
	type TLShapeId,
	toRichText,
} from 'tldraw'
import { CLAUDE_META } from '../perception/shapeRoles'

type RenderPayload = CanvasCommandPayload<'note.render'>
type RenderResult = CanvasCommandResult<'note.render'>

/** Label on the first line of every note of Claude's; `read_canvas` leaves it out of the text. */
export const AGENT_NOTE_LABEL = 'Claude'
/** Space between a note and the shape it answers, and between it and the shapes around it. */
export const AGENT_NOTE_GAP = 40
const CONTENT_GAP = 80
/** Width and least height of a tldraw note, in page units; the height grows with the text. */
const NOTE_SIZE = 200
const VIEW_INSET = 64
/** How many shapes a note slides past before it stops looking for free space. */
const MAX_PLACEMENT_STEPS = 50

/** Look that tells Claude's notes from the user's yellow, handwritten stickies at a glance. */
const AGENT_NOTE_LOOK = { color: 'light-violet', font: 'sans', size: 's' } as const

export interface AgentNoteMeta {
	/** Stable id given to `render_note`, if any. */
	agentNoteId?: string
}

/** Marks a note as Claude's (ADR 0026); the `note` shape type alone cannot say. */
export function agentNoteMeta(meta: JsonObject): AgentNoteMeta | undefined {
	if (meta.agentNote !== true) return undefined
	return typeof meta.agentNoteId === 'string' ? { agentNoteId: meta.agentNoteId } : {}
}

export function agentNoteShapeId(id: string): TLShapeId {
	return createShapeId(`agent-note:${id}`)
}

function agentNoteRichText(text: string): TLRichText {
	const body = toRichText(text)
	const label = {
		type: 'paragraph',
		content: [{ type: 'text', text: AGENT_NOTE_LABEL, marks: [{ type: 'bold' }] }],
	}
	return { ...body, content: [label, ...body.content] }
}

/**
 * Put Claude's note on the canvas (ADR 0026), or update the one with the same
 * `id` in place, wherever the user left it. A new note goes right next to
 * `replyTo`, top-aligned with it and sliding down past whatever stands there;
 * without `replyTo`, to the right of the page content. One undo step.
 */
export function renderNote(editor: Editor, payload: RenderPayload): RenderResult {
	const target = payload.replyTo ? editor.getShape(payload.replyTo as TLShapeId) : undefined
	if (payload.replyTo && !target) {
		throw new Error(
			`There is no shape "${payload.replyTo}" on the canvas to reply to; ` +
				'use a shape id from read_canvas.',
		)
	}
	const shapeId = payload.id ? agentNoteShapeId(payload.id) : createShapeId()
	const existing = payload.id ? editor.getShape<TLNoteShape>(shapeId) : undefined
	const richText = agentNoteRichText(payload.text)
	const meta = {
		...CLAUDE_META,
		agentNote: true,
		...(payload.id ? { agentNoteId: payload.id } : {}),
	}

	editor.run(() => {
		if (existing) {
			editor.updateShape<TLNoteShape>({
				id: shapeId,
				type: 'note',
				props: { richText, ...AGENT_NOTE_LOOK },
				meta,
			})
			return
		}
		const position = target ? besideTarget(editor, target.id) : newOrigin(editor)
		editor.createShape<TLNoteShape>({
			id: shapeId,
			type: 'note',
			x: position.x,
			y: position.y,
			props: { richText, ...AGENT_NOTE_LOOK },
			meta,
		})
	})

	const bounds = editor.getShapePageBounds(shapeId)
	if (!existing && bounds && !editor.getViewportPageBounds().contains(bounds)) {
		editor.zoomToBounds(Box.ExpandBy(bounds, VIEW_INSET), {
			targetZoom: Math.min(1, editor.getZoomLevel()),
		})
	}
	return {
		shapeId,
		created: !existing,
		...(target ? { replyToShapeId: target.id } : {}),
	}
}

/** Right of the target, top-aligned, down past every top-level shape in the way. */
function besideTarget(editor: Editor, targetId: TLShapeId) {
	const targetBounds = editor.getShapePageBounds(targetId)
	if (!targetBounds) return newOrigin(editor)
	const candidate = new Box(
		Math.round(targetBounds.maxX + AGENT_NOTE_GAP),
		Math.round(targetBounds.minY),
		NOTE_SIZE,
		NOTE_SIZE,
	)
	const obstacles = editor
		.getCurrentPageShapes()
		.filter((shape) => shape.parentId === editor.getCurrentPageId() && shape.id !== targetId)
		.flatMap((shape) => {
			const bounds = editor.getShapePageBounds(shape.id)
			return bounds ? [bounds] : []
		})
	for (let step = 0; step < MAX_PLACEMENT_STEPS; step++) {
		const padded = Box.ExpandBy(candidate, AGENT_NOTE_GAP / 2)
		const blocking = obstacles.filter((bounds) => Box.Collides(padded, bounds))
		if (blocking.length === 0) break
		candidate.y = Math.round(Math.max(...blocking.map((bounds) => bounds.maxY)) + AGENT_NOTE_GAP)
	}
	return { x: candidate.x, y: candidate.y }
}

/** Right of everything on the page, top-aligned with it; on an empty page, centred in the viewport. */
function newOrigin(editor: Editor) {
	const content = editor.getCurrentPageBounds()
	if (content) return { x: Math.round(content.maxX + CONTENT_GAP), y: Math.round(content.minY) }
	const center = editor.getViewportPageBounds().center
	return { x: Math.round(center.x - NOTE_SIZE / 2), y: Math.round(center.y - NOTE_SIZE / 2) }
}
