import { z } from 'zod'
import { checkNodesAndEdges, edgeKey } from './graph'

/**
 * Diagrams Claude draws with `render_diagram` and compares with `compare`
 * (ADR 0014, ADR 0015). The canonical spec is a JSON graph: nodes with a label and a
 * look, and directed edges with an optional label. Claude supplies structure
 * only; the canvas lays it out in the house style of the frontier graph.
 */

export const MAX_DIAGRAM_NODES = 60
export const MAX_DIAGRAM_EDGES = 120
export const MIN_COMPARE_ITEMS = 2
export const MAX_COMPARE_ITEMS = 3

/** Stable key of a diagram, comparison, or of a node in a diagram. */
export const DiagramIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(/^[A-Za-z0-9_.:-]+$/, 'use letters, digits and _ . : - only')

/** How a node looks: a box (default), an ellipse (e.g. a store or actor) or a diamond (a choice). */
export const DiagramNodeLookSchema = z.enum(['box', 'ellipse', 'diamond'])
export type DiagramNodeLook = z.infer<typeof DiagramNodeLookSchema>

export const DiagramNodeSchema = z.object({
	id: DiagramIdSchema.describe(
		'Stable id. In a comparison, give the same element the same id in every alternative: nodes are matched by id.',
	),
	label: z.string().trim().min(1).max(120).describe('Text in the node, a few words.'),
	look: DiagramNodeLookSchema.optional().describe(
		'"box" (default), "ellipse" (e.g. a data store or actor) or "diamond" (a choice).',
	),
})
export type DiagramNode = z.infer<typeof DiagramNodeSchema>

export const DiagramEdgeSchema = z.object({
	from: z.string().min(1).describe('Id of the node the arrow starts at.'),
	to: z.string().min(1).describe('Id of the node the arrow points to.'),
	label: z
		.string()
		.trim()
		.min(1)
		.max(60)
		.optional()
		.describe('Optional short text on the arrow, e.g. what flows along it.'),
})
export type DiagramEdge = z.infer<typeof DiagramEdgeSchema>

/** Structural schema of a diagram spec; use {@link DiagramSpecSchema} to validate. */
export const DiagramSpecShape = {
	nodes: z.array(DiagramNodeSchema).min(1).max(MAX_DIAGRAM_NODES),
	edges: z.array(DiagramEdgeSchema).max(MAX_DIAGRAM_EDGES).default([]),
}

/** A diagram spec without the cross-field checks (see {@link checkNodesAndEdges}). */
export const DiagramSpecObject = z.object(DiagramSpecShape)

/** A complete diagram spec: unique node ids, edges only between known nodes, no duplicates. */
export const DiagramSpecSchema = DiagramSpecObject.superRefine((spec, ctx) =>
	checkNodesAndEdges(spec, ctx),
)
export type DiagramSpec = z.infer<typeof DiagramSpecSchema>

/** Input of `render_diagram`. */
export const RenderDiagramShape = {
	id: DiagramIdSchema.describe(
		'Stable id of the diagram. Rendering again with the same id updates it in place.',
	),
	title: z
		.string()
		.trim()
		.min(1)
		.max(80)
		.optional()
		.describe('Name shown on the diagram frame; defaults to the id.'),
	spec: DiagramSpecObject.describe(
		'The diagram: nodes {id, label, look?} and edges {from, to, label?}.',
	),
}

export const RenderDiagramSchema = z.object(RenderDiagramShape).superRefine((input, ctx) => {
	checkNodesAndEdges(input.spec, ctx, ['spec'])
})
export type RenderDiagramInput = z.infer<typeof RenderDiagramSchema>

/** Why an element of one alternative is highlighted. */
export type DifferenceKind =
	/** The node or edge is missing from at least one other alternative. */
	| 'not_in_all'
	/** Every alternative has it, but its label or look differs. */
	| 'changed'

export interface ElementDifference {
	/** Node id, or edge key `from->to`. */
	id: string
	kind: DifferenceKind
}

/** What sets one alternative apart from the others. */
export interface AlternativeDifferences {
	nodes: ElementDifference[]
	edges: ElementDifference[]
}

/**
 * The differences between 2 or 3 alternatives (ADR 0015): per alternative,
 * its nodes and edges that are not the same in all of them. Nodes are matched
 * by id, edges by their endpoints (`from->to`). An element counts as the same
 * when every alternative has it with the same label (and, for nodes, look).
 */
export function diffAlternatives(specs: readonly DiagramSpec[]): AlternativeDifferences[] {
	const nodeSignature = (node: DiagramNode) => `${node.label}\u0000${node.look ?? 'box'}`
	const edgeSignature = (edge: DiagramEdge) => edge.label ?? ''
	const nodeMaps = specs.map(
		(spec) => new Map(spec.nodes.map((node) => [node.id, nodeSignature(node)])),
	)
	const edgeMaps = specs.map(
		(spec) => new Map(spec.edges.map((edge) => [edgeKey(edge), edgeSignature(edge)])),
	)
	const classify = (maps: Map<string, string>[], id: string, signature: string) => {
		if (!maps.every((map) => map.has(id))) return 'not_in_all'
		return maps.every((map) => map.get(id) === signature) ? undefined : 'changed'
	}
	return specs.map((spec) => ({
		nodes: spec.nodes.flatMap((node) => {
			const kind = classify(nodeMaps, node.id, nodeSignature(node))
			return kind ? [{ id: node.id, kind }] : []
		}),
		edges: spec.edges.flatMap((edge) => {
			const id = edgeKey(edge)
			const kind = classify(edgeMaps, id, edgeSignature(edge))
			return kind ? [{ id, kind }] : []
		}),
	}))
}
