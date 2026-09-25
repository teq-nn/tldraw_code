import { edgeKey } from '@tldraw-code/protocol'
import { type LayoutEdge, type LayoutNode, type LayoutResult, layoutGraph } from '../graph/layout'

/** The nodes (sized to their slots) and edges of one frame of a diagram row. */
export interface FrameGraph {
	nodes: LayoutNode[]
	edges: LayoutEdge[]
}

/**
 * One layout per frame of a diagram row (ADR 0015). Frames share the layout
 * of the union of their nodes and edges, so a node common to the alternatives
 * sits in the same place in each, as long as every frame still reads left to
 * right in it. When alternatives connect the same nodes in conflicting orders
 * (A before B in one, B before A in the other), the union has no such layout:
 * dagre breaks the conflict somewhere, so one frame's flow runs backwards and
 * the reversed edge bends the others, and a plain chain looks like a tangle
 * (#23). Then every frame gets a layout of its own graph instead: each flow in
 * edge order beats alignment between flows that disagree on the order.
 */
export function layoutFrames(frames: FrameGraph[]): LayoutResult[] {
	const slots = new Map<string, LayoutNode>()
	const edges = new Map<string, LayoutEdge>()
	for (const frame of frames) {
		for (const node of frame.nodes) {
			const slot = slots.get(node.id)
			slots.set(node.id, {
				id: node.id,
				w: Math.max(node.w, slot?.w ?? 0),
				h: Math.max(node.h, slot?.h ?? 0),
			})
		}
		for (const edge of frame.edges) edges.set(edgeKey(edge), edge)
	}
	const shared = layoutGraph([...slots.values()], [...edges.values()])
	if (frames.every((frame) => readsLeftToRight(frame, shared))) return frames.map(() => shared)
	return frames.map((frame) =>
		layoutGraph(
			frame.nodes.map((node) => slots.get(node.id) ?? node),
			frame.edges,
		),
	)
}

/**
 * Whether every edge of the frame points right in the layout. Edges on a
 * cycle of the frame's own graph are exempt: some edge of a cycle must point back.
 */
function readsLeftToRight(frame: FrameGraph, layout: LayoutResult): boolean {
	const successors = new Map<string, string[]>()
	for (const { from, to } of frame.edges) {
		successors.set(from, [...(successors.get(from) ?? []), to])
	}
	const x = (id: string) => layout.positions.get(id)?.x ?? 0
	return frame.edges.every(({ from, to }) => x(from) < x(to) || reaches(successors, to, from))
}

function reaches(successors: Map<string, string[]>, start: string, target: string): boolean {
	const seen = new Set([start])
	const stack = [start]
	for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
		if (id === target) return true
		for (const next of successors.get(id) ?? []) {
			if (!seen.has(next)) {
				seen.add(next)
				stack.push(next)
			}
		}
	}
	return false
}
