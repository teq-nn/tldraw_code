import { z } from 'zod'

/**
 * The frontier graph Claude hands to `render_graph` (ADR 0005). Claude supplies
 * structure only: decision nodes with a status, and dependency edges. Layout,
 * colours and the frontier are derived, never supplied.
 */

export const DecisionStatusSchema = z.enum(['open', 'resolved', 'blocked'])
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>

export const MAX_GRAPH_NODES = 200
export const MAX_GRAPH_EDGES = 400

export const DecisionNodeSchema = z.object({
	id: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[A-Za-z0-9_.:-]+$/, 'use letters, digits and _ . : - only')
		.describe(
			'Stable id, e.g. a ticket number or slug. Re-rendering with the same id updates the node.',
		),
	title: z.string().min(1).max(120).describe('Short name of the decision, ideally a few words.'),
	status: DecisionStatusSchema.describe(
		'open: still to decide; resolved: decided; blocked: cannot be decided yet.',
	),
	note: z
		.string()
		.min(1)
		.max(200)
		.optional()
		.describe('Optional one-line label under the title, e.g. the answer a resolved decision got.'),
})
export type DecisionNode = z.infer<typeof DecisionNodeSchema>

export const DependencyEdgeSchema = z.object({
	from: z.string().min(1).describe('Id of the node that must be resolved first (the blocker).'),
	to: z.string().min(1).describe('Id of the node that depends on it.'),
})
export type DependencyEdge = z.infer<typeof DependencyEdgeSchema>

/** Structural schema without cross-field checks; use {@link FrontierGraphSchema} to validate. */
export const FrontierGraphShape = {
	nodes: z.array(DecisionNodeSchema).min(1).max(MAX_GRAPH_NODES),
	edges: z.array(DependencyEdgeSchema).max(MAX_GRAPH_EDGES).default([]),
}

/** A complete frontier graph: unique node ids, edges only between known nodes, no duplicates. */
export const FrontierGraphSchema = z
	.object(FrontierGraphShape)
	.superRefine((graph, ctx) => checkNodesAndEdges(graph, ctx))
export type FrontierGraph = z.infer<typeof FrontierGraphSchema>

/** Stable identity of an edge, used to update rather than duplicate its arrow. */
export function edgeKey(edge: DependencyEdge): string {
	return `${edge.from}->${edge.to}`
}

/**
 * The frontier: open nodes whose blockers (the `from` end of every incoming
 * edge) are all resolved, i.e. what can be decided next. Order follows `nodes`.
 */
export function computeFrontier(graph: Pick<FrontierGraph, 'nodes' | 'edges'>): string[] {
	const status = new Map(graph.nodes.map((node) => [node.id, node.status]))
	const unresolvedBlockers = new Set(
		graph.edges.filter((edge) => status.get(edge.from) !== 'resolved').map((edge) => edge.to),
	)
	return graph.nodes
		.filter((node) => node.status === 'open' && !unresolvedBlockers.has(node.id))
		.map((node) => node.id)
}

/**
 * Structural checks shared by frontier graphs and diagram specs: unique node
 * ids, edges only between known nodes, no self-edges, no duplicate edges.
 * Issues are reported on `nodes.<i>.id` / `edges.<i>[.from|.to]`, relative
 * to `path`.
 */
export function checkNodesAndEdges(
	graph: { nodes: readonly { id: string }[]; edges: readonly DependencyEdge[] },
	ctx: z.RefinementCtx,
	path: (string | number)[] = [],
): void {
	const ids = new Set<string>()
	graph.nodes.forEach((node, index) => {
		if (ids.has(node.id)) {
			ctx.addIssue({
				code: 'custom',
				path: [...path, 'nodes', index, 'id'],
				message: `duplicate node id '${node.id}'`,
			})
		}
		ids.add(node.id)
	})
	const edgeKeys = new Set<string>()
	graph.edges.forEach((edge, index) => {
		for (const end of ['from', 'to'] as const) {
			if (!ids.has(edge[end])) {
				ctx.addIssue({
					code: 'custom',
					path: [...path, 'edges', index, end],
					message: `edge ${end} '${edge[end]}' is not a node id`,
				})
			}
		}
		if (edge.from === edge.to) {
			ctx.addIssue({
				code: 'custom',
				path: [...path, 'edges', index],
				message: `edge cannot connect node '${edge.from}' to itself`,
			})
		}
		const key = edgeKey(edge)
		if (edgeKeys.has(key)) {
			ctx.addIssue({
				code: 'custom',
				path: [...path, 'edges', index],
				message: `duplicate edge ${edge.from} -> ${edge.to}`,
			})
		}
		edgeKeys.add(key)
	})
}
