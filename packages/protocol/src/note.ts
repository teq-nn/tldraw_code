import { z } from 'zod'
import { DiagramIdSchema } from './diagram'

/**
 * Notes Claude puts on the canvas with `render_note` (ADR 0026): a short
 * reply, e.g. to a sticky note that addressed it with `&agent`. The canvas
 * owns the look and the placement; the server only validates and forwards.
 */

export const MAX_NOTE_LENGTH = 500

/** Stable key of a note; the same alphabet as diagram ids. */
export const NoteIdSchema = DiagramIdSchema

/** Input of `render_note`. */
export const RenderNoteShape = {
	text: z
		.string()
		.trim()
		.min(1)
		.max(MAX_NOTE_LENGTH)
		.describe(`The note, short (at most ${MAX_NOTE_LENGTH} characters). Plain text.`),
	replyTo: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Id of the shape this note answers, as read_canvas lists it (e.g. the user's sticky note). " +
				'The note is placed right next to it. Without it the note goes to the right of everything on the canvas.',
		),
	id: NoteIdSchema.optional().describe(
		'Stable id. Rendering again with the same id updates that note in place instead of adding another.',
	),
}

export const RenderNoteSchema = z.object(RenderNoteShape)
export type RenderNoteInput = z.infer<typeof RenderNoteSchema>
