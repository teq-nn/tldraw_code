import { Graph, layout } from '@dagrejs/dagre'

export interface LayoutNode {
	id: string
	w: number
	h: number
}

export interface LayoutEdge {
	from: string
	to: string
}

export interface LayoutResult {
	/** Top-left corner of every node, relative to the layout's own origin (0, 0). */
	positions: Map<string, { x: number; y: number }>
	width: number
	height: number
}

/**
 * The house layout style for graphs on the canvas (ADR 0004): layered,
 * left to right, blockers left of what they block. Pure and deterministic, so
 * the same graph always lands in the same place and `render_diagram` (#8) can
 * reuse it for side-by-side comparisons.
 */
export const GRAPH_LAYOUT_STYLE = {
	rankdir: 'LR',
	nodesep: 40,
	ranksep: 90,
	edgesep: 20,
	marginx: 0,
	marginy: 0,
} as const

export function layoutGraph(nodes: LayoutNode[], edges: LayoutEdge[]): LayoutResult {
	const g = new Graph()
	g.setGraph({ ...GRAPH_LAYOUT_STYLE })
	g.setDefaultEdgeLabel(() => ({}))
	for (const node of nodes) g.setNode(node.id, { width: node.w, height: node.h })
	for (const edge of edges) g.setEdge(edge.from, edge.to)
	layout(g)

	const positions = new Map<string, { x: number; y: number }>()
	let width = 0
	let height = 0
	for (const node of nodes) {
		// dagre reports centres; tldraw positions shapes by their top-left corner.
		const { x, y } = g.node(node.id)
		const position = { x: Math.round(x - node.w / 2), y: Math.round(y - node.h / 2) }
		positions.set(node.id, position)
		width = Math.max(width, position.x + node.w)
		height = Math.max(height, position.y + node.h)
	}
	return { positions, width, height }
}
