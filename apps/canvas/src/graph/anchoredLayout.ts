import { Graph, layout } from '@dagrejs/dagre'
import {
	GRAPH_LAYOUT_STYLE,
	type GraphLayout,
	type LayoutEdge,
	type LayoutNode,
	type LayoutResult,
	layoutResult,
} from './layout'

/**
 * Layout flavour F1 "anchored" (issue #27, docs/research/canvas-layout.md
 * §12–13): the house dagre layout (ADR 0004), re-run globally on every
 * render as today, but stable across updates of the same graph.
 *
 * - One dagre `Graph` is kept per graph key and updated in place, so dagre's
 *   dynamic mode (keyed by `Graph` identity) reuses the previous layout, and
 *   nodes are handed to dagre in a stable order: the order they first
 *   appeared in, whatever order a later call lists them in.
 * - Persisting nodes that share a rank keep the top-to-bottom order they had
 *   in the previous layout: that order is passed to dagre as order
 *   constraints. New nodes go wherever crossing reduction puts them.
 *
 * The returned function lays out the graph with the given key. Its state
 * lives as long as the function does, so a reloaded canvas starts afresh.
 */
export function createAnchoredLayout(): (
	key: string,
	...graph: Parameters<GraphLayout>
) => LayoutResult {
	const graphs = new Map<string, Graph>()
	return (key, nodes, edges) => {
		const g = graphs.get(key) ?? newGraph()
		graphs.set(key, g)
		const previousY = centresY(g)
		update(g, nodes, edges)

		// Ranks do not depend on the in-rank order, so a throwaway copy yields them.
		const ranks = rankOf(g)
		const constraints = [...groupBy(ranks)].flatMap(([, ids]) =>
			chain(
				ids
					.filter((id) => previousY.has(id))
					.sort((a, b) => (previousY.get(a) ?? 0) - (previousY.get(b) ?? 0)),
			),
		)
		layout(g, { constraints })
		return layoutResult(g, nodes)
	}
}

function newGraph(): Graph {
	const g = new Graph()
	g.setGraph({ ...GRAPH_LAYOUT_STYLE })
	g.setDefaultEdgeLabel(() => ({}))
	return g
}

/** Centre y of every node of the graph's last layout. */
function centresY(g: Graph): Map<string, number> {
	return new Map(
		g.nodes().flatMap((id) => {
			const y = g.node(id)?.y
			return typeof y === 'number' ? [[id, y] as const] : []
		}),
	)
}

/** Bring the kept graph in line with this call: sizes, new and gone nodes and edges. */
function update(g: Graph, nodes: LayoutNode[], edges: LayoutEdge[]): void {
	const wantedNodes = new Set(nodes.map((node) => node.id))
	for (const id of g.nodes()) if (!wantedNodes.has(id)) g.removeNode(id)
	const wantedEdges = new Set(edges.map((edge) => edgeId(edge.from, edge.to)))
	for (const edge of g.edges()) if (!wantedEdges.has(edgeId(edge.v, edge.w))) g.removeEdge(edge)
	// Existing nodes keep their place in dagre's node order; new ones join at the end.
	for (const node of nodes) {
		const label = g.node(node.id)
		if (label) {
			label.width = node.w
			label.height = node.h
		} else g.setNode(node.id, { width: node.w, height: node.h })
	}
	for (const edge of edges) if (!g.hasEdge(edge.from, edge.to)) g.setEdge(edge.from, edge.to)
}

function edgeId(from: string, to: string): string {
	return JSON.stringify([from, to])
}

function rankOf(g: Graph): Map<string, number> {
	const copy = newGraph()
	for (const id of g.nodes()) {
		const { width, height } = g.node(id)
		copy.setNode(id, { width, height })
	}
	for (const edge of g.edges()) copy.setEdge(edge.v, edge.w)
	layout(copy)
	return new Map(copy.nodes().map((id) => [id, copy.node(id).rank ?? 0]))
}

function groupBy(ranks: Map<string, number>): Map<number, string[]> {
	const groups = new Map<number, string[]>()
	for (const [id, rank] of ranks) groups.set(rank, [...(groups.get(rank) ?? []), id])
	return groups
}

/** Order constraints keeping `ids` in this order: each one left of (above) the next. */
function chain(ids: string[]): { left: string; right: string }[] {
	return ids.slice(1).map((right, index) => ({ left: ids[index] as string, right }))
}
