import type {
	CanvasCommandPayload,
	CanvasCommandResult,
	DiagramNodeLook,
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
	type TLFrameShape,
	type TLGeoShape,
	type TLShape,
	type TLShapeId,
	type TLShapePartial,
	type TLTextShape,
	toRichText,
} from 'tldraw'
import { gridCell, gridColumns, QUESTION_CARD_SLOT } from '../comparison/arrangement'
import { UNSETTLED, unpinComparison } from '../comparison/comparisonFrames'
import { layoutFrames } from './frameLayouts'

type RenderPayload = CanvasCommandPayload<'diagram.render'>
type RenderResult = CanvasCommandResult<'diagram.render'>
type DiagramKind = RenderPayload['kind']
type FramePayload = RenderPayload['frames'][number]

/** Colour of the nodes and edges that differ between compared alternatives (ADR 0015). */
export const DIFFERENCE_COLOR: TLDefaultColorStyle = 'orange'
const COMMON_NODE_COLOR: TLDefaultColorStyle = 'black'
const COMMON_EDGE_COLOR: TLDefaultColorStyle = 'grey'
/** Legend under the caption of every compared alternative. */
export const DIFFERENCE_LEGEND = 'Orange: differs from the other alternatives'

export const DIAGRAM_NODE_WIDTH = 180
const DIAGRAM_NODE_MIN_HEIGHT = 70
/** Inner margin of a frame around its diagram. */
export const FRAME_PADDING = 32
/** Height reserved for the caption and legend lines at the top of a frame. */
const CAPTION_HEIGHT = 64
const MIN_FRAME_WIDTH = 320
/** Space between the frames of a comparison, and between existing content and a new row. */
export const FRAME_GAP = 80
const CONTENT_GAP = 160
const VIEW_INSET = 64

const GEO_BY_LOOK: Record<DiagramNodeLook, TLGeoShape['props']['geo']> = {
	box: 'rectangle',
	ellipse: 'ellipse',
	diamond: 'diamond',
}

/** Marker stored in `shape.meta` of every shape a diagram render owns. */
export interface DiagramShapeMeta {
	[key: string]: string | number | boolean
	diagramPart: 'frame' | 'node' | 'edge' | 'caption'
	diagramKind: DiagramKind
	diagramId: string
	/** Position of the frame in the row (0 for a lone diagram). */
	frameIndex: number
	/** Title of the frame, i.e. the alternative's label in a comparison. */
	frameTitle: string
	/** Node id or edge key `from->to`; empty for frames and captions. */
	element: string
	/** Highlighted as a difference between compared alternatives. */
	differs: boolean
	originX: number
	originY: number
}

/** The diagram marker of a shape a diagram render owns, or undefined for any other shape. */
export function diagramMeta(meta: unknown): DiagramShapeMeta | undefined {
	const m = meta as Partial<DiagramShapeMeta> | undefined
	return m && typeof m.diagramPart === 'string' && typeof m.diagramId === 'string'
		? (m as DiagramShapeMeta)
		: undefined
}

function groupKey(kind: DiagramKind, id: string, frameIndex: number): string {
	return `${kind}:${id}#${frameIndex}`
}

export function diagramFrameId(kind: DiagramKind, id: string, frameIndex: number): TLShapeId {
	return createShapeId(`diagram-frame:${groupKey(kind, id, frameIndex)}`)
}

export function diagramNodeId(
	kind: DiagramKind,
	id: string,
	frameIndex: number,
	nodeId: string,
): TLShapeId {
	return createShapeId(`diagram-node:${groupKey(kind, id, frameIndex)}/${nodeId}`)
}

export function diagramEdgeId(
	kind: DiagramKind,
	id: string,
	frameIndex: number,
	edge: { from: string; to: string },
): TLShapeId {
	return createShapeId(`diagram-edge:${groupKey(kind, id, frameIndex)}/${edgeKey(edge)}`)
}

export function diagramCaptionId(kind: DiagramKind, id: string, frameIndex: number): TLShapeId {
	return createShapeId(`diagram-caption:${groupKey(kind, id, frameIndex)}`)
}

/** The frames of one diagram or comparison on the current page, in row order. */
export function getDiagramFrames(editor: Editor, kind: DiagramKind, id: string): TLShape[] {
	return editor
		.getCurrentPageShapes()
		.filter((shape) => {
			const meta = diagramMeta(shape.meta)
			return meta?.diagramPart === 'frame' && meta.diagramKind === kind && meta.diagramId === id
		})
		.sort((a, b) => (diagramMeta(a.meta)?.frameIndex ?? 0) - (diagramMeta(b.meta)?.frameIndex ?? 0))
}

/**
 * Draw one diagram (`render_diagram`) or 2 to 3 compared alternatives
 * (`compare`) as native tldraw shapes in frames side by side (ADR 0015), or
 * bring an earlier rendering of the same kind and id up to date. All frames
 * share one layout, computed with the frontier graph's house style over the
 * union of their nodes and edges, so a node common to the alternatives sits
 * in the same place in every frame and only real differences stand out.
 * Highlighted nodes and edges are drawn in {@link DIFFERENCE_COLOR}. All
 * changes land in one undo step.
 */
export function renderDiagrams(editor: Editor, payload: RenderPayload): RenderResult {
	const { kind, id } = payload
	const result: RenderResult = {
		frameIds: [],
		nodes: { created: 0, updated: 0, removed: 0 },
		edges: { created: 0, updated: 0, removed: 0 },
	}
	const owned = (shape: TLShape) => {
		const meta = diagramMeta(shape.meta)
		return meta?.diagramKind === kind && meta.diagramId === id
	}
	const existing = editor.getCurrentPageShapes().filter(owned)
	const firstRender = existing.length === 0
	const previousMeta = existing.map((shape) => diagramMeta(shape.meta)).find(Boolean)
	// Page content before this render, to place a new row next to it.
	const contentBounds = firstRender ? editor.getCurrentPageBounds() : undefined
	const withCaption = payload.frames.some((frame) => frame.caption) || kind === 'comparison'

	editor.run(() => {
		// 0. A comparison shown again is open again: its earlier choice no longer holds (ADR 0021).
		if (kind === 'comparison') unpinComparison(editor, id)

		// 1. Remove shapes of frames, nodes and edges that are no longer in the payload.
		const wanted = new Set<TLShapeId>()
		payload.frames.forEach((frame, index) => {
			wanted.add(diagramFrameId(kind, id, index))
			if (withCaption) wanted.add(diagramCaptionId(kind, id, index))
			for (const node of frame.nodes) wanted.add(diagramNodeId(kind, id, index, node.id))
			for (const edge of frame.edges) wanted.add(diagramEdgeId(kind, id, index, edge))
		})
		const stale = existing.filter((shape) => !wanted.has(shape.id))
		for (const shape of stale) {
			const part = diagramMeta(shape.meta)?.diagramPart
			if (part === 'node') result.nodes.removed++
			if (part === 'edge') result.edges.removed++
		}
		editor.deleteShapes(stale.map((shape) => shape.id))

		// 2. Upsert the frames (sized later) and the nodes in them, so the nodes' real sizes are known.
		const origin = previousMeta
			? { x: previousMeta.originX, y: previousMeta.originY }
			: { x: 0, y: 0 }
		payload.frames.forEach((frame, index) => {
			const frameId = diagramFrameId(kind, id, index)
			const frameShape: TLShapePartial<TLFrameShape> = {
				id: frameId,
				type: 'frame',
				parentId: editor.getCurrentPageId(),
				props: { name: frame.title, color: 'black' },
			}
			if (editor.getShape(frameId)) editor.updateShape(frameShape)
			else editor.createShape({ ...frameShape, x: origin.x, y: origin.y })
			result.frameIds.push(frameId)

			const highlighted = new Set(frame.highlight.nodes)
			for (const node of frame.nodes) {
				const nodeId = diagramNodeId(kind, id, index, node.id)
				const differs = highlighted.has(node.id)
				const props: Partial<TLGeoShape['props']> = {
					geo: GEO_BY_LOOK[node.look ?? 'box'],
					w: DIAGRAM_NODE_WIDTH,
					h: DIAGRAM_NODE_MIN_HEIGHT,
					color: differs ? DIFFERENCE_COLOR : COMMON_NODE_COLOR,
					labelColor: 'black',
					// Same look as the frontier graph: differences stand out like frontier nodes do.
					fill: differs ? 'solid' : 'semi',
					dash: differs ? 'solid' : 'draw',
					size: 'm',
					font: 'sans',
					align: 'middle',
					verticalAlign: 'middle',
					richText: toRichText(node.label),
				}
				const shape: TLShapePartial<TLGeoShape> = {
					id: nodeId,
					type: 'geo',
					parentId: frameId,
					rotation: 0,
					props,
					meta: meta('node', payload, frame, index, node.id, differs),
				}
				if (editor.getShape(nodeId)) {
					editor.updateShape(shape)
					result.nodes.updated++
				} else {
					editor.createShape(shape)
					result.nodes.created++
				}
			}
		})

		// 3. One layout for all frames, over the union of their nodes and edges,
		// unless the frames order the same nodes differently (#23).
		const slots = new Map<string, { w: number; h: number }>()
		payload.frames.forEach((frame, index) => {
			for (const node of frame.nodes) {
				const { w, h } = nodeSize(editor, diagramNodeId(kind, id, index, node.id))
				const slot = slots.get(node.id)
				slots.set(node.id, { w: Math.max(w, slot?.w ?? 0), h: Math.max(h, slot?.h ?? 0) })
			}
		})
		const layouts = layoutFrames(
			payload.frames.map((frame) => ({
				nodes: frame.nodes.map((node) => ({
					id: node.id,
					...(slots.get(node.id) ?? { w: 0, h: 0 }),
				})),
				edges: frame.edges,
			})),
		)
		const layoutW = Math.max(...layouts.map((layout) => layout.width))
		const layoutH = Math.max(...layouts.map((layout) => layout.height))
		const top = FRAME_PADDING + (withCaption ? CAPTION_HEIGHT : 0)
		const frameW = Math.max(MIN_FRAME_WIDTH, layoutW + 2 * FRAME_PADDING)
		const frameH = top + layoutH + FRAME_PADDING
		// A compact grid instead of one long row, with room for the question card on the left (ADR 0029).
		const cell = { w: frameW, h: frameH }
		const count = payload.frames.length
		const cardSlot = kind === 'comparison' ? QUESTION_CARD_SLOT : 0
		const columns = gridColumns(count, cell, FRAME_GAP, cardSlot)
		const rows = Math.ceil(count / columns)
		const block = {
			w: cardSlot + columns * frameW + (columns - 1) * FRAME_GAP,
			h: rows * frameH + (rows - 1) * FRAME_GAP,
		}
		const rowOrigin = previousMeta
			? origin
			: shift(newRowOrigin(editor, contentBounds, block.w, block.h), cardSlot)

		payload.frames.forEach((frame, index) => {
			const frameId = diagramFrameId(kind, id, index)
			const offset = gridCell(index, columns, cell, FRAME_GAP)
			const layout = layouts[index] ?? { positions: new Map(), width: 0, height: 0 }
			// Centre the diagram in frames made wider than it by the minimum width or a wider alternative.
			const left = Math.round((frameW - layout.width) / 2)
			editor.updateShape<TLFrameShape>({
				id: frameId,
				type: 'frame',
				x: rowOrigin.x + offset.x,
				y: rowOrigin.y + offset.y,
				rotation: 0,
				opacity: 1,
				props: { w: frameW, h: frameH },
				meta: { ...meta('frame', payload, frame, index, '', false, rowOrigin), ...UNSETTLED },
			})

			// 4. Place the nodes in their slots, centred when smaller than the slot.
			editor.updateShapes<TLGeoShape>(
				frame.nodes.map((node) => {
					const shapeId = diagramNodeId(kind, id, index, node.id)
					const position = layout.positions.get(node.id) ?? { x: 0, y: 0 }
					const slot = slots.get(node.id) ?? { w: 0, h: 0 }
					const { w, h } = nodeSize(editor, shapeId)
					const differs = frame.highlight.nodes.includes(node.id)
					return {
						id: shapeId,
						type: 'geo',
						x: left + position.x + Math.round((slot.w - w) / 2),
						y: top + position.y + Math.round((slot.h - h) / 2),
						meta: meta('node', payload, frame, index, node.id, differs, rowOrigin),
					}
				}),
			)

			// 5. The caption line(s) at the top of the frame.
			if (withCaption) {
				const lines = [frame.caption, kind === 'comparison' ? DIFFERENCE_LEGEND : undefined]
				const text: TLShapePartial<TLTextShape> = {
					id: diagramCaptionId(kind, id, index),
					type: 'text',
					parentId: frameId,
					x: FRAME_PADDING,
					y: FRAME_PADDING / 2,
					rotation: 0,
					meta: meta('caption', payload, frame, index, '', false, rowOrigin),
					props: {
						richText: toRichText(lines.filter(Boolean).join('\n')),
						autoSize: false,
						w: frameW - 2 * FRAME_PADDING,
						size: 's',
						font: 'sans',
						color: 'grey',
						textAlign: 'start',
					},
				}
				if (editor.getShape(text.id)) editor.updateShape(text)
				else editor.createShape(text)
			}

			// 6. One bound arrow per edge.
			const highlightedEdges = new Set(frame.highlight.edges)
			for (const edge of frame.edges) {
				const arrowId = diagramEdgeId(kind, id, index, edge)
				const differs = highlightedEdges.has(edgeKey(edge))
				const arrow: TLShapePartial<TLArrowShape> = {
					id: arrowId,
					type: 'arrow',
					parentId: frameId,
					meta: meta('edge', payload, frame, index, edgeKey(edge), differs, rowOrigin),
					props: {
						color: differs ? DIFFERENCE_COLOR : COMMON_EDGE_COLOR,
						labelColor: 'black',
						size: differs ? 'l' : 'm',
						dash: 'solid',
						bend: 0,
						arrowheadEnd: 'arrow',
						font: 'sans',
						richText: toRichText(edge.label ?? ''),
					},
				}
				const nodeShape = (nodeId: string) => diagramNodeId(kind, id, index, nodeId)
				if (editor.getShape(arrowId)) {
					editor.updateShape(arrow)
					editor.deleteBindings(editor.getBindingsFromShape<TLArrowBinding>(arrowId, 'arrow'))
					result.edges.updated++
				} else {
					editor.createShape(arrow)
					result.edges.created++
				}
				editor.createBindings<TLArrowBinding>([
					arrowBinding(arrowId, nodeShape(edge.from), 'start'),
					arrowBinding(arrowId, nodeShape(edge.to), 'end'),
				])
			}
		})
	})

	if (firstRender) {
		const bounds = editor.getShapesPageBounds(result.frameIds as TLShapeId[])
		if (bounds && !editor.getViewportPageBounds().contains(bounds)) {
			editor.zoomToBounds(Box.ExpandBy(bounds, VIEW_INSET), {
				targetZoom: Math.min(1, editor.getZoomLevel()),
			})
		}
	}
	return result
}

function meta(
	diagramPart: DiagramShapeMeta['diagramPart'],
	{ kind, id }: Pick<RenderPayload, 'kind' | 'id'>,
	frame: FramePayload,
	frameIndex: number,
	element: string,
	differs: boolean,
	origin: { x: number; y: number } = { x: 0, y: 0 },
): DiagramShapeMeta {
	return {
		diagramPart,
		diagramKind: kind,
		diagramId: id,
		frameIndex,
		frameTitle: frame.title,
		element,
		differs,
		originX: origin.x,
		originY: origin.y,
	}
}

/** A node's real size: its label may have grown it beyond the default. */
function nodeSize(editor: Editor, shapeId: TLShapeId): { w: number; h: number } {
	if (!editor.getShape(shapeId)) return { w: DIAGRAM_NODE_WIDTH, h: DIAGRAM_NODE_MIN_HEIGHT }
	const { w, h } = editor.getShapeGeometry(shapeId).bounds
	return { w: Math.round(w), h: Math.round(h) }
}

function shift(point: { x: number; y: number }, dx: number) {
	return { x: point.x + dx, y: point.y }
}

/**
 * Where a new block of frames goes: to the right of everything on the page,
 * top-aligned with it, so the space below the frontier graph stays free for
 * question cards; on an empty page, centred in the viewport.
 */
function newRowOrigin(editor: Editor, content: Box | undefined, width: number, height: number) {
	if (content) return { x: Math.round(content.maxX + CONTENT_GAP), y: Math.round(content.minY) }
	const center = editor.getViewportPageBounds().center
	return { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) }
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
