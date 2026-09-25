import { bringIntoView, questionCardId, showQuestion } from '../ask/showQuestion'
import { layoutGraph } from '../graph/layout'
import { moveIntoFreeSpace, placeInFreeSpace } from '../graph/placeInFreeSpace'
import { renderGraph } from '../graph/renderGraph'
import { tidyGraph } from '../graph/tidyGraph'
import { createCommandHandlers } from './commandHandlers'
import type { LayoutFlavour } from './layoutFlavours'

/**
 * Layout flavour F2 "user-owned space" (issue #28, docs/research/canvas-layout.md
 * §12): the baseline's handlers, except that `graph.render` never moves a node
 * it placed before and puts new ones in free space beside their blockers, and
 * a new question card keeps clear of the user's shapes, so it takes over none
 * of their notes' anchors (ADR 0008). A render with `tidy` lays the whole
 * graph out afresh, once, and moves the notes on a node with it (issue #29).
 */
export const USER_OWNED_FLAVOUR: LayoutFlavour = {
	name: 'user-owned',
	summary:
		'Placed nodes never move, dragged ones included; new nodes go into free space beside their blockers; removed ones leave their gap.',
	createHandlers(editor, deps = {}) {
		const asClaude = <T>(run: () => T): T => (deps.activity ? deps.activity.asClaude(run) : run())
		return {
			...createCommandHandlers(editor, deps),
			'graph.render': (payload) =>
				asClaude(() =>
					payload.tidy
						? tidyGraph(editor, payload)
						: renderGraph(editor, payload, layoutGraph, placeInFreeSpace),
				),
			'ask.show': (payload) =>
				asClaude(() => {
					const result = showQuestion(editor, payload)
					if (result.created) {
						moveIntoFreeSpace(editor, questionCardId(payload.askId))
						bringIntoView(editor, questionCardId(payload.askId))
					}
					return result
				}),
		}
	},
}
