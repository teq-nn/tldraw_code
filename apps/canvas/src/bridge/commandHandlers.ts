import { createShapeId, type Editor, toRichText } from 'tldraw'
import { showQuestion } from '../ask/showQuestion'
import { renderDiagrams } from '../diagram/renderDiagrams'
import { renderGraph } from '../graph/renderGraph'
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

/** Implementation of every protocol command against a live tldraw editor. */
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
		'graph.render': (payload) => asClaude(() => renderGraph(editor, payload)),
		'diagram.render': (payload) => asClaude(() => renderDiagrams(editor, payload)),
		'ask.show': (payload) => asClaude(() => showQuestion(editor, payload)),
		'prototype.render': (payload) => asClaude(() => renderPrototype(editor, payload)),
		'canvas.read': (payload) => readCanvas(editor, payload, { capture, activity }),
		'canvas.activity': () =>
			activity ? activity.snapshot() : { added: {}, changed: 0, removed: 0 },
	}
}
