import { createShapeId, type Editor, type TLShape, type TLShapeId } from 'tldraw'
import { diagramMeta, getDiagramFrames } from '../diagram/renderDiagrams'
import { isPrototypeFrame, type PrototypeFrameShape } from '../prototype/PrototypeShapeUtil'

/**
 * The alternatives of one comparison on the canvas (`compare`, ADR 0015,
 * ADR 0020): diagram frames, or prototype frames that carry the comparison
 * in their meta. Also the settle state they carry once the user has chosen
 * (ADR 0021).
 */

export interface ComparisonFrame {
	shape: TLShape
	kind: 'diagram' | 'prototype'
	/** The alternative's label: the frame title of a diagram, the label of a prototype. */
	label: string
	index: number
}

/** Meta of a prototype frame that is alternative `comparisonIndex` of `comparisonId`. */
export interface PrototypeComparisonMeta {
	comparisonId: string
	comparisonIndex: number
}

/** Settle state in the meta of a comparison's frames (ADR 0021). '' / 0 when unsettled. */
export interface ChoiceMeta {
	[key: string]: string | number
	choice: '' | 'chosen' | 'rejected'
	/** Why a rejected alternative lost. */
	choiceReason: string
	/** Height of a collapsed frame before it was collapsed. */
	expandedH: number
	/** What the collapse replaced: a prototype's caption, or a diagram caption's rich text as JSON. */
	expandedCaption: string
}

export const UNSETTLED: ChoiceMeta = {
	choice: '',
	choiceReason: '',
	expandedH: 0,
	expandedCaption: '',
}

export function choiceOf(shape: TLShape): ChoiceMeta {
	const meta = shape.meta as Partial<ChoiceMeta>
	return {
		choice: meta.choice === 'chosen' || meta.choice === 'rejected' ? meta.choice : '',
		choiceReason: typeof meta.choiceReason === 'string' ? meta.choiceReason : '',
		expandedH: typeof meta.expandedH === 'number' ? meta.expandedH : 0,
		expandedCaption: typeof meta.expandedCaption === 'string' ? meta.expandedCaption : '',
	}
}

export function prototypeComparisonOf(shape: TLShape): PrototypeComparisonMeta | undefined {
	const meta = shape.meta as Partial<PrototypeComparisonMeta>
	return typeof meta.comparisonId === 'string' && typeof meta.comparisonIndex === 'number'
		? { comparisonId: meta.comparisonId, comparisonIndex: meta.comparisonIndex }
		: undefined
}

/** The frames of comparison `id`, in row order: its diagram frames, else its prototype frames. */
export function getComparisonFrames(editor: Editor, id: string): ComparisonFrame[] {
	const diagrams = getDiagramFrames(editor, 'comparison', id)
	if (diagrams.length > 0) {
		return diagrams.map((shape) => {
			const meta = diagramMeta(shape.meta)
			return {
				shape,
				kind: 'diagram',
				label: meta?.frameTitle ?? '',
				index: meta?.frameIndex ?? 0,
			}
		})
	}
	return editor
		.getCurrentPageShapes()
		.filter(
			(shape): shape is PrototypeFrameShape =>
				isPrototypeFrame(shape) && prototypeComparisonOf(shape)?.comparisonId === id,
		)
		.map((shape) => ({
			shape,
			kind: 'prototype' as const,
			label: shape.props.label,
			index: prototypeComparisonOf(shape)?.comparisonIndex ?? 0,
		}))
		.sort((a, b) => a.index - b.index)
}

/** The arrow pinning a comparison's chosen alternative to its decision node. */
export function choicePinId(comparisonId: string): TLShapeId {
	return createShapeId(`choice-pin:${comparisonId}`)
}

/** Marker in the meta of a choice pin. */
export interface ChoicePinMeta {
	[key: string]: string
	choicePin: string
	/** Decision node id the pin starts at. */
	node: string
	createdBy: 'claude'
}

export function choicePinMeta(meta: unknown): ChoicePinMeta | undefined {
	const m = meta as Partial<ChoicePinMeta> | undefined
	return m && typeof m.choicePin === 'string' ? (m as ChoicePinMeta) : undefined
}

/**
 * Forget that comparison `id` was settled, because it is being shown again:
 * remove its pin. The renders reset the frames themselves.
 */
export function unpinComparison(editor: Editor, id: string): void {
	if (editor.getShape(choicePinId(id))) editor.deleteShapes([choicePinId(id)])
}

/**
 * `getShapeVisibility` of the editor: the content of a collapsed (rejected)
 * diagram frame is hidden, all but its caption line with the reason, so
 * arrows do not stick out of the collapsed frame. The shapes stay in the
 * store; expanding the frame shows them again (ADR 0021).
 */
export function hideCollapsedContent(shape: TLShape, editor: Editor): 'hidden' | 'inherit' {
	const parent = editor.getShape(shape.parentId as TLShapeId)
	if (parent?.type !== 'frame' || choiceOf(parent).choice !== 'rejected') return 'inherit'
	return diagramMeta(shape.meta)?.diagramPart === 'caption' ? 'inherit' : 'hidden'
}
