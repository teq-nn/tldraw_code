import { createShapeId, type Editor, toRichText } from 'tldraw'
import { renderGraph } from '../graph/renderGraph'
import type { CommandHandlers } from './BridgeClient'

const SMOKE_SHAPE_SIZE = { w: 280, h: 120 }

/** Implementation of every protocol command against a live tldraw editor. */
export function createCommandHandlers(editor: Editor): CommandHandlers {
	return {
		'smoke.create_shape': ({ text }) => {
			const center = editor.getViewportPageBounds().center
			const id = createShapeId()
			editor.createShape({
				id,
				type: 'geo',
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
		},
		'graph.render': (payload) => renderGraph(editor, payload),
	}
}
