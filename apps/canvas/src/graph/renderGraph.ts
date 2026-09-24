import type {
	CanvasCommandPayload,
	CanvasCommandResult,
	DecisionStatus,
} from '@tldraw-code/protocol'
import { edgeKey } from '@tldraw-code/protocol'
import {
	Box,
	createShapeId,
	type Editor,
	type TLArrowBinding,
	type TLArrowShape,
	type TLBindingCreate,
	type TLDefaultColorStyle,
	type TLGeoShape,
	type TLRichText,
	type TLShapeId,
	type TLShapePartial,
	toRichText,
} from 'tldraw'
import { collapseAnsweredQuestion } from '../ask/collapseQuestion'
import { layoutGraph } from './layout'

type RenderPayload = CanvasCommandPayload<'graph.render'>
type RenderResult = CanvasCommandResult<'graph.render'>

/** Status colours of decision nodes (ADR 0005). */
export const STATUS_COLOR: Record<DecisionStatus, TLDefaultColorStyle> = {
	open: 'blue',
	resolved: 'green',
	blocked: 'red',
}

export const NODE_WIDTH = 220
export const NODE_MIN_HEIGHT = 80
const EDGE_COLOR: TLDefaultColorStyle = 'grey'
/** Gap kept around a freshly placed graph when zooming to it. */
const VIEW_INSET = 64

/** Marker stored in `shape.meta` of every shape `render_graph` owns. */
export interface GraphShapeMeta {
	[key: string]: string | number
	graphPart: 'node' | 'edge'
	graphKey: string
	originX: number
	originY: number
}

export function nodeShapeId(nodeId: string): TLShapeId {
	return createShapeId(`graph-node:${nodeId}`)
}

export function edgeShapeId(from: string, to: string): TLShapeId {
	return createShapeId(`graph-edge:${edgeKey({ from, to })}`)
}

/** The graph marker of a shape `render_graph` owns, or undefined for any other shape. */
export function graphMeta(meta: unknown): GraphShapeMeta | undefined {
	const m = meta as Partial<GraphShapeMeta> | undefined
	return m && (m.graphPart === 'node' || m.graphPart === 'edge') ? (m as GraphShapeMeta) : undefined
}

/**
 * Draw the frontier graph as native tldraw shapes, or bring an earlier
 * rendering up to date. Shapes are keyed by node id / edge endpoints, so a
 * repeated call updates them in place, adds what is new and removes what is
 * gone; nothing is duplicated. All changes land in one undo step.
 */
export function renderGraph(editor: Editor, payload: RenderPayload): RenderResult {
	const result: RenderResult = {
		nodes: { created: 0, updated: 0, removed: 0 },
		edges: { created: 0, updated: 0, removed: 0 },
		questionCollapsed: false,
	}
	const frontier = new Set(payload.frontier)
	const existing = editor
		.getCurrentPageShapes()
		.filter((shape) => graphMeta(shape.meta) !== undefined)
	const firstRender = existing.length === 0
	// Keep the graph where it was: every graph shape remembers the layout origin.
	const previousMeta = existing.map((shape) => graphMeta(shape.meta)).find(Boolean)

	editor.run(() => {
		// 0. The answered question card gives way to the graph, which now carries its answer (ADR 0010).
		if (payload.collapseQuestion) {
			result.questionCollapsed = collapseAnsweredQuestion(editor, payload.collapseQuestion)
		}

		// 1. Remove shapes of nodes and edges that are no longer in the graph.
		const wanted = new Set<TLShapeId>([
			...payload.nodes.map((node) => nodeShapeId(node.id)),
			...payload.edges.map((edge) => edgeShapeId(edge.from, edge.to)),
		])
		const stale = existing.filter((shape) => !wanted.has(shape.id))
		for (const shape of stale)
			result[graphMeta(shape.meta)?.graphPart === 'node' ? 'nodes' : 'edges'].removed++
		editor.deleteShapes(stale.map((shape) => shape.id))

		// 2. Upsert node shapes with their text and style, so their real size is known.
		for (const node of payload.nodes) {
			const id = nodeShapeId(node.id)
			const onFrontier = frontier.has(node.id)
			const props: Partial<TLGeoShape['props']> = {
				geo: 'rectangle',
				w: NODE_WIDTH,
				h: NODE_MIN_HEIGHT,
				color: STATUS_COLOR[node.status],
				labelColor: 'black',
				// The frontier stands out: solid fill and a heavy outline; the rest stays light.
				fill: onFrontier ? 'solid' : 'semi',
				dash: node.status === 'blocked' ? 'dashed' : onFrontier ? 'solid' : 'draw',
				size: onFrontier ? 'l' : 'm',
				font: 'sans',
				align: 'middle',
				verticalAlign: 'middle',
				richText: nodeText(node.title, node.note),
			}
			if (editor.getShape(id)) {
				editor.updateShape<TLGeoShape>({ id, type: 'geo', props })
				result.nodes.updated++
			} else {
				editor.createShape<TLGeoShape>({ id, type: 'geo', props })
				result.nodes.created++
			}
		}

		// 3. Lay the graph out with the nodes' actual sizes (text may have grown them).
		const sized = payload.nodes.map((node) => {
			const bounds = editor.getShapePageBounds(nodeShapeId(node.id))
			return { id: node.id, w: bounds?.w ?? NODE_WIDTH, h: bounds?.h ?? NODE_MIN_HEIGHT }
		})
		const layout = layoutGraph(sized, payload.edges)
		const origin = previousMeta
			? { x: previousMeta.originX, y: previousMeta.originY }
			: centredOrigin(editor, layout.width, layout.height)

		editor.updateShapes<TLGeoShape>(
			payload.nodes.map((node) => {
				const position = layout.positions.get(node.id) ?? { x: 0, y: 0 }
				return {
					id: nodeShapeId(node.id),
					type: 'geo',
					parentId: editor.getCurrentPageId(),
					x: origin.x + position.x,
					y: origin.y + position.y,
					rotation: 0,
					meta: meta('node', node.id, origin),
				}
			}),
		)

		// 4. Upsert one bound arrow per edge, pointing from blocker to dependent.
		for (const edge of payload.edges) {
			const id = edgeShapeId(edge.from, edge.to)
			const arrow: TLShapePartial<TLArrowShape> = {
				id,
				type: 'arrow',
				parentId: editor.getCurrentPageId(),
				meta: meta('edge', edgeKey(edge), origin),
				props: { color: EDGE_COLOR, size: 'm', dash: 'solid', bend: 0, arrowheadEnd: 'arrow' },
			}
			if (editor.getShape(id)) {
				editor.updateShape(arrow)
				editor.deleteBindings(editor.getBindingsFromShape<TLArrowBinding>(id, 'arrow'))
				result.edges.updated++
			} else {
				editor.createShape(arrow)
				result.edges.created++
			}
			editor.createBindings<TLArrowBinding>([
				arrowBinding(id, nodeShapeId(edge.from), 'start'),
				arrowBinding(id, nodeShapeId(edge.to), 'end'),
			])
		}
	})

	// Show the graph when it is new, or when the card the user was looking at gave way to it.
	if (firstRender || result.questionCollapsed) {
		const bounds = editor.getShapesPageBounds(payload.nodes.map((node) => nodeShapeId(node.id)))
		if (bounds && !editor.getViewportPageBounds().contains(bounds)) {
			editor.zoomToBounds(
				Box.ExpandBy(bounds, VIEW_INSET),
				firstRender ? undefined : { targetZoom: Math.min(1, editor.getZoomLevel()) },
			)
		}
	}
	return result
}

/**
 * A node's label: the title, and under it the note in italics, so an answer
 * reads as a label on the decision rather than part of its name.
 */
function nodeText(title: string, note: string | undefined): TLRichText {
	const text = toRichText(note ? `${title}\n${note}` : title)
	if (!note) return text
	const [first, ...rest] = text.content as { type: string; content?: { marks?: unknown[] }[] }[]
	const italic = rest.map((paragraph) => ({
		...paragraph,
		content: paragraph.content?.map((run) => ({ ...run, marks: [{ type: 'italic' }] })),
	}))
	return { ...text, content: [first, ...italic] } as TLRichText
}

function meta(
	graphPart: GraphShapeMeta['graphPart'],
	graphKey: string,
	origin: { x: number; y: number },
): GraphShapeMeta {
	return { graphPart, graphKey, originX: origin.x, originY: origin.y }
}

function arrowBinding(
	arrowId: TLShapeId,
	nodeId: TLShapeId,
	terminal: 'start' | 'end',
): TLBindingCreate<TLArrowBinding> {
	return {
		type: 'arrow',
		fromId: arrowId,
		toId: nodeId,
		props: {
			terminal,
			normalizedAnchor: { x: 0.5, y: 0.5 },
			isExact: false,
			isPrecise: false,
			snap: 'none',
		},
	}
}

/** Place a new graph centred in the current viewport. */
function centredOrigin(editor: Editor, width: number, height: number) {
	const center = editor.getViewportPageBounds().center
	return { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) }
}
