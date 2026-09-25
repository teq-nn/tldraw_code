import { createAnchoredLayout } from '../graph/anchoredLayout'
import { renderGraph } from '../graph/renderGraph'
import { createCommandHandlers } from './commandHandlers'
import type { LayoutFlavour } from './layoutFlavours'

/**
 * Layout flavour F1 "anchored" (issue #27, docs/research/canvas-layout.md
 * §12): the baseline with a stable graph layout. Only `graph.render` differs;
 * its graph key is the page, as there is one graph per page (ADR 0005).
 */
export const ANCHORED_FLAVOUR: LayoutFlavour = {
	name: 'anchored',
	summary:
		'Baseline, but the graph keeps one dagre graph per page and persisting nodes keep their in-rank order.',
	createHandlers(editor, deps) {
		const baseline = createCommandHandlers(editor, deps)
		const anchored = createAnchoredLayout()
		const activity = deps?.activity
		const asClaude = <T>(run: () => T): T => (activity ? activity.asClaude(run) : run())
		return {
			...baseline,
			'graph.render': (payload) =>
				asClaude(() => {
					const key = editor.getCurrentPageId()
					return renderGraph(editor, payload, (nodes, edges) => anchored(key, nodes, edges))
				}),
		}
	},
}
