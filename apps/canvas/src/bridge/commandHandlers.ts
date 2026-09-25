import { createShapeId, type Editor, toRichText } from 'tldraw'
import { bringIntoView, questionCardId, showQuestion } from '../ask/showQuestion'
import { settleComparison } from '../comparison/settleComparison'
import { renderDiagrams } from '../diagram/renderDiagrams'
import { moveIntoFreeSpace, placeInFreeSpace } from '../graph/placeInFreeSpace'
import { renderGraph } from '../graph/renderGraph'
import { tidyGraph } from '../graph/tidyGraph'
import { renderNote } from '../note/renderNote'
import type { ActivityTracker } from '../perception/activity'
import { readCanvas } from '../perception/readCanvas'
import { type CaptureScreenshot, captureScreenshot } from '../perception/screenshot'
import { CLAUDE_META } from '../perception/shapeRoles'
import { renderPrototype } from '../prototype/renderPrototype'
import type { CommandHandlers } from './BridgeClient'

const SMOKE_SHAPE_SIZE = { w: 280, h: 120 }

export interface CommandHandlerDeps {
	/** Counts the user's changes; Claude's own commands run through {@link ActivityTracker.asClaude}. */
	activity?: ActivityTracker
	/** Screenshot implementation; the default needs a real browser. */
	capture?: CaptureScreenshot
}

/**
 * Implementation of every protocol command against a live tldraw editor. The
 * canvas is user-owned space (ADR 0032): `graph.render` never moves a node it
 * placed before and puts new ones in free space beside their blockers, unless
 * the render is a tidy, and a new question card keeps clear of the user's
 * shapes, so it takes over none of their notes' anchors (ADR 0008).
 */
export function createCommandHandlers(
	editor: Editor,
	{ activity, capture = captureScreenshot }: CommandHandlerDeps = {},
): CommandHandlers {
	const asClaude = <T>(run: () => T): T => (activity ? activity.asClaude(run) : run())
	return {
		'smoke.create_shape': ({ text }) =>
			asClaude(() => {
				const center = editor.getViewportPageBounds().center
				const id = createShapeId()
				editor.createShape({
					id,
					type: 'geo',
					meta: { ...CLAUDE_META },
					x: center.x - SMOKE_SHAPE_SIZE.w / 2,
					y: center.y - SMOKE_SHAPE_SIZE.h / 2,
					props: {
						geo: 'rectangle',
						...SMOKE_SHAPE_SIZE,
						color: 'violet',
						fill: 'semi',
						richText: toRichText(text),
					},
				})
				return { shapeId: id }
			}),
		'graph.render': (payload) =>
			asClaude(() =>
				payload.tidy ? tidyGraph(editor, payload) : renderGraph(editor, payload, placeInFreeSpace),
			),
		'diagram.render': (payload) => asClaude(() => renderDiagrams(editor, payload)),
		'ask.show': (payload) =>
			asClaude(() => {
				const result = showQuestion(editor, payload)
				if (result.created) {
					moveIntoFreeSpace(editor, questionCardId(payload.askId))
					bringIntoView(editor, questionCardId(payload.askId))
				}
				return result
			}),
		'note.render': (payload) => asClaude(() => renderNote(editor, payload)),
		'prototype.render': (payload) => asClaude(() => renderPrototype(editor, payload)),
		'comparison.settle': (payload) => asClaude(() => settleComparison(editor, payload)),
		'canvas.read': (payload) => readCanvas(editor, payload, { capture, activity }),
		'canvas.activity': () =>
			activity ? activity.snapshot() : { added: {}, changed: 0, removed: 0 },
	}
}
