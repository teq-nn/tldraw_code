import type { CanvasCommandPayload, CanvasCommandResult } from '@tldraw-code/protocol'
import {
	type Editor,
	type TLArrowBinding,
	type TLArrowShape,
	type TLBindingCreate,
	type TLFrameShape,
	type TLRichText,
	type TLShapeId,
	type TLShapePartial,
	type TLTextShape,
	toRichText,
} from 'tldraw'
import { diagramCaptionId, diagramMeta, FRAME_PADDING } from '../diagram/renderDiagrams'
import { nodeShapeId } from '../graph/renderGraph'
import {
	PROTOTYPE_FRAME_TYPE,
	PROTOTYPE_HEADER_HEIGHT,
	type PrototypeFrameShape,
} from '../prototype/PrototypeShapeUtil'
import {
	type ChoiceMeta,
	type ChoicePinMeta,
	type ComparisonFrame,
	choiceOf,
	choicePinId,
	getComparisonFrames,
} from './comparisonFrames'

type SettlePayload = CanvasCommandPayload<'comparison.settle'>
type SettleResult = CanvasCommandResult<'comparison.settle'>

/** Opacity of a rejected alternative: still legible, clearly not the choice. */
export const REJECTED_OPACITY = 0.5
const PIN_LABEL = 'chosen'

/**
 * Settle comparison `id` after the user chose (ADR 0021). The chosen
 * alternative is marked (green frame titled "... (chosen)", or a "Chosen"
 * badge on a prototype) and pinned to its decision node by a green dashed
 * arrow; every other one is collapsed to its title bar, dimmed, with
 * "Rejected: <reason>" as its caption. Nothing is deleted: a collapsed
 * alternative keeps its content, and settling again with another choice
 * expands it. One undo step.
 */
export function settleComparison(editor: Editor, payload: SettlePayload): SettleResult {
	const frames = getComparisonFrames(editor, payload.id)
	if (frames.length === 0) {
		throw new Error(`There is no comparison "${payload.id}" on the canvas; call compare first.`)
	}
	const byLabel = (label: string) =>
		frames.find((frame) => frame.label.toLowerCase() === label.trim().toLowerCase())
	const labels = frames.map((frame) => `"${frame.label}"`).join(', ')
	const chosen = byLabel(payload.chosen)
	if (!chosen) {
		throw new Error(
			`"${payload.chosen}" is not an alternative of comparison "${payload.id}"; its alternatives are ${labels}.`,
		)
	}
	const reasons = new Map<ComparisonFrame, string>()
	for (const entry of payload.rejected) {
		const frame = byLabel(entry.label)
		if (!frame || frame === chosen) {
			throw new Error(
				`"${entry.label}" is not a rejected alternative of comparison "${payload.id}"; its alternatives are ${labels}.`,
			)
		}
		reasons.set(frame, entry.reason)
	}
	const missing = frames.filter((frame) => frame !== chosen && !reasons.has(frame))
	if (missing.length > 0) {
		throw new Error(
			`Give a reason for every alternative that was not chosen; missing: ${missing
				.map((frame) => `"${frame.label}"`)
				.join(', ')}.`,
		)
	}

	let pinId: TLShapeId | null = null
	editor.run(() => {
		for (const frame of frames) {
			const reason = reasons.get(frame)
			if (reason === undefined) markChosen(editor, frame)
			else collapseRejected(editor, frame, reason)
		}
		pinId = pinChoice(editor, payload, chosen)
	})
	return {
		kind: chosen.kind,
		chosenFrameId: chosen.shape.id,
		rejectedFrameIds: frames.filter((frame) => frame !== chosen).map((frame) => frame.shape.id),
		pinId,
	}
}

function markChosen(editor: Editor, frame: ComparisonFrame): void {
	const previous = choiceOf(frame.shape)
	const meta: ChoiceMeta = { choice: 'chosen', choiceReason: '', expandedH: 0, expandedCaption: '' }
	if (frame.kind === 'prototype') {
		const shape = frame.shape as PrototypeFrameShape
		editor.updateShape<PrototypeFrameShape>({
			id: shape.id,
			type: PROTOTYPE_FRAME_TYPE,
			opacity: 1,
			meta,
			props:
				previous.choice === 'rejected'
					? { h: previous.expandedH, caption: previous.expandedCaption }
					: {},
		})
		return
	}
	const shape = frame.shape as TLFrameShape
	if (previous.choice === 'rejected') restoreCaption(editor, shape, previous)
	editor.updateShape<TLFrameShape>({
		id: shape.id,
		type: 'frame',
		opacity: 1,
		meta,
		props: {
			name: `${frame.label} (chosen)`,
			color: 'green',
			...(previous.choice === 'rejected' ? { h: previous.expandedH } : {}),
		},
	})
}

function collapseRejected(editor: Editor, frame: ComparisonFrame, reason: string): void {
	const previous = choiceOf(frame.shape)
	const wasCollapsed = previous.choice === 'rejected'
	const line = `Rejected: ${reason}`
	if (frame.kind === 'prototype') {
		const shape = frame.shape as PrototypeFrameShape
		editor.updateShape<PrototypeFrameShape>({
			id: shape.id,
			type: PROTOTYPE_FRAME_TYPE,
			opacity: REJECTED_OPACITY,
			meta: {
				choice: 'rejected',
				choiceReason: reason,
				expandedH: wasCollapsed ? previous.expandedH : shape.props.h,
				expandedCaption: wasCollapsed ? previous.expandedCaption : shape.props.caption,
			} satisfies ChoiceMeta,
			props: { h: PROTOTYPE_HEADER_HEIGHT, caption: line },
		})
		return
	}
	const shape = frame.shape as TLFrameShape
	const captionId = captionOf(shape)
	const caption = editor.getShape<TLTextShape>(captionId)
	editor.updateShape<TLTextShape>({
		id: captionId,
		type: 'text',
		props: { richText: toRichText(line) },
	})
	const captionHeight = editor.getShapeGeometry(captionId).bounds.h
	editor.updateShape<TLFrameShape>({
		id: shape.id,
		type: 'frame',
		opacity: REJECTED_OPACITY,
		meta: {
			choice: 'rejected',
			choiceReason: reason,
			expandedH: wasCollapsed ? previous.expandedH : shape.props.h,
			expandedCaption: wasCollapsed
				? previous.expandedCaption
				: JSON.stringify(caption?.props.richText ?? toRichText('')),
		} satisfies ChoiceMeta,
		props: {
			name: `${frame.label} (rejected)`,
			color: 'grey',
			// The title bar of the frame plus the reason; the diagram below stays inside, clipped.
			h: Math.ceil(FRAME_PADDING / 2 + captionHeight + FRAME_PADDING / 2),
		},
	})
}

/** Put a collapsed diagram frame's own caption back. */
function restoreCaption(editor: Editor, frame: TLFrameShape, previous: ChoiceMeta): void {
	if (!previous.expandedCaption) return
	editor.updateShape<TLTextShape>({
		id: captionOf(frame),
		type: 'text',
		props: { richText: JSON.parse(previous.expandedCaption) as TLRichText },
	})
}

function captionOf(frame: TLFrameShape): TLShapeId {
	const meta = diagramMeta(frame.meta)
	return diagramCaptionId('comparison', meta?.diagramId ?? '', meta?.frameIndex ?? 0)
}

/** A green dashed arrow from the decision node to the chosen alternative, or none if the node is not drawn. */
function pinChoice(
	editor: Editor,
	payload: SettlePayload,
	chosen: ComparisonFrame,
): TLShapeId | null {
	const id = choicePinId(payload.id)
	const node = nodeShapeId(payload.node)
	if (!editor.getShape(node)) {
		if (editor.getShape(id)) editor.deleteShapes([id])
		return null
	}
	const meta: ChoicePinMeta = { choicePin: payload.id, node: payload.node, createdBy: 'claude' }
	const arrow: TLShapePartial<TLArrowShape> = {
		id,
		type: 'arrow',
		parentId: editor.getCurrentPageId(),
		meta,
		props: {
			color: 'green',
			labelColor: 'green',
			size: 'm',
			dash: 'dashed',
			bend: 0,
			arrowheadStart: 'dot',
			arrowheadEnd: 'arrow',
			font: 'sans',
			richText: toRichText(PIN_LABEL),
		},
	}
	if (editor.getShape(id)) {
		editor.updateShape(arrow)
		editor.deleteBindings(editor.getBindingsFromShape<TLArrowBinding>(id, 'arrow'))
	} else {
		editor.createShape(arrow)
	}
	editor.createBindings<TLArrowBinding>([
		binding(id, node, 'start'),
		binding(id, chosen.shape.id, 'end'),
	])
	return id
}

function binding(
	arrowId: TLShapeId,
	target: TLShapeId,
	terminal: 'start' | 'end',
): TLBindingCreate<TLArrowBinding> {
	return {
		type: 'arrow',
		fromId: arrowId,
		toId: target,
		props: {
			terminal,
			normalizedAnchor: { x: 0.5, y: 0.5 },
			isExact: false,
			isPrecise: false,
			snap: 'none',
		},
	}
}
