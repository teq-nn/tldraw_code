import {
	type CanvasCommandPayload,
	type CanvasCommandResult,
	type CanvasShape,
	type DecisionStatus,
	MAX_READ_SHAPES,
	type PageBox,
	type ShapeAnchor,
} from '@tldraw-code/protocol'
import {
	Box,
	type Editor,
	renderPlaintextFromRichText,
	type TLArrowBinding,
	type TLRichText,
	type TLShape,
} from 'tldraw'
import type { QuestionCardShape } from '../ask/QuestionCardShapeUtil'
import { getQuestionCards, isQuestionCard } from '../ask/showQuestion'
import { answerOf, NOTE_REACH } from '../ask/watchQuestionCards'
import { choiceOf, prototypeComparisonOf } from '../comparison/comparisonFrames'
import { diagramMeta } from '../diagram/renderDiagrams'
import { graphMeta, STATUS_COLOR } from '../graph/renderGraph'
import { AGENT_NOTE_LABEL, agentNoteMeta } from '../note/renderNote'
import {
	isPrototypeFrame,
	PROTOTYPE_HEADER_HEIGHT,
	viewportOf,
} from '../prototype/PrototypeShapeUtil'
import type { ActivityTracker } from './activity'
import type { CaptureScreenshot } from './screenshot'
import { isClaudeShape, roleOf } from './shapeRoles'

type ReadPayload = CanvasCommandPayload<'canvas.read'>
type ReadResult = CanvasCommandResult<'canvas.read'>

/** Margin around the page content when reading `all`. */
const ALL_MARGIN = 32
/** How far from a Claude shape a user shape still counts as annotating it (same as note answers). */
export const ANCHOR_REACH = NOTE_REACH
const MAX_TEXT_LENGTH = 500

export interface ReadCanvasDeps {
	capture: CaptureScreenshot
	activity?: ActivityTracker
}

/**
 * Read a region of the canvas (ADR 0008): every shape that touches it, with
 * its role, owner, text and bounds, user shapes linked to the decision node or
 * question card they annotate, plus a screenshot of the region. Resets the
 * activity digest, because Claude has now seen the canvas.
 */
export async function readCanvas(
	editor: Editor,
	payload: ReadPayload,
	{ capture, activity }: ReadCanvasDeps,
): Promise<ReadResult> {
	activity?.reset()
	const region = resolveRegion(editor, payload.region)
	if (!region) return { region: null, shapes: [], omitted: 0, screenshot: null }

	const inRegion = editor
		.getCurrentPageShapes()
		.filter((shape) => {
			const bounds = editor.getShapePageBounds(shape.id)
			return bounds !== undefined && Box.Collides(region, bounds)
		})
		.map((shape) => describeShape(editor, shape))
		// The user's shapes first: they are what Claude has not seen yet.
		.sort(
			(a, b) =>
				Number(a.owner === 'claude') - Number(b.owner === 'claude') ||
				a.bounds.y - b.bounds.y ||
				a.bounds.x - b.bounds.x,
		)
	const shapes = inRegion.slice(0, MAX_READ_SHAPES)
	const result: ReadResult = {
		region: toPageBox(region),
		shapes,
		omitted: inRegion.length - shapes.length,
		screenshot: null,
	}
	if (!payload.screenshot) return result

	// Export top-level shapes only; tldraw includes their children.
	const topLevel = editor.getSortedChildIdsForParent(editor.getCurrentPageId()).filter((id) => {
		const bounds = editor.getShapePageBounds(id)
		return bounds !== undefined && Box.Collides(region, bounds)
	})
	if (topLevel.length === 0) {
		result.screenshotError = 'the region is empty'
		return result
	}
	try {
		result.screenshot = await capture(editor, topLevel, region)
	} catch (error) {
		result.screenshotError = error instanceof Error ? error.message : String(error)
	}
	return result
}

function resolveRegion(editor: Editor, region: ReadPayload['region']): Box | undefined {
	switch (region) {
		case 'all': {
			const bounds = editor.getCurrentPageBounds()
			return bounds ? Box.ExpandBy(bounds, ALL_MARGIN) : undefined
		}
		case 'viewport':
			return editor.getViewportPageBounds().clone()
		case 'question': {
			const card = getQuestionCards(editor)[0]
			const bounds = card && editor.getShapePageBounds(card.id)
			if (!bounds) throw new Error('There is no question card on the canvas.')
			return Box.ExpandBy(bounds, ANCHOR_REACH)
		}
		default:
			return new Box(region.x, region.y, region.w, region.h)
	}
}

function describeShape(editor: Editor, shape: TLShape): CanvasShape {
	const role = roleOf(shape)
	const owner = isClaudeShape(shape) ? 'claude' : 'user'
	const bounds = editor.getShapePageBounds(shape.id) ?? new Box(shape.x, shape.y, 0, 0)
	const props = shape.props as Partial<{
		richText: TLRichText
		color: string
		geo: string
		name: string
		fill: string
	}>
	const described: CanvasShape = {
		id: shape.id,
		type: shape.type,
		role,
		owner,
		bounds: toPageBox(bounds),
	}

	const text = textOf(editor, shape)
	if (text) described.text = text
	if (props.color) described.color = props.color
	if (shape.type === 'geo' && props.geo) described.geo = props.geo

	const graph = graphMeta(shape.meta)
	if (graph) described.decisionId = graph.graphKey
	if (role === 'decision_node') {
		described.status = statusOfColor(props.color)
		described.onFrontier = props.fill === 'solid'
	}
	if (isQuestionCard(shape)) described.question = questionOf(shape)
	if (isPrototypeFrame(shape)) {
		const { prototypeId, label, iterationOf } = shape.props
		described.prototype = { id: prototypeId, label, ...viewportOf(shape) }
		if (iterationOf) described.prototype.iterationOf = iterationOf
		const comparison = prototypeComparisonOf(shape)
		if (comparison) described.prototype.comparison = comparison.comparisonId
	}
	const choice = choiceOf(shape)
	if (choice.choice === 'chosen') described.choice = { state: 'chosen' }
	if (choice.choice === 'rejected') {
		described.choice = { state: 'rejected', reason: choice.choiceReason }
	}
	const diagram = diagramMeta(shape.meta)
	if (diagram) {
		described.diagram = {
			kind: diagram.diagramKind,
			id: diagram.diagramId,
			frame: diagram.frameTitle,
		}
		if (diagram.element) described.diagram.element = diagram.element
		if (diagram.differs) described.diagram.differs = true
	}

	if (shape.type === 'arrow') {
		for (const binding of editor.getBindingsFromShape<TLArrowBinding>(shape.id, 'arrow')) {
			if (binding.props.terminal === 'start') described.fromShapeId = binding.toId
			else described.toShapeId = binding.toId
		}
	}
	const frame = editor.findShapeAncestor(shape, (parent) => parent.type === 'frame')
	if (frame) described.frameId = frame.id
	if (owner === 'user') {
		const anchor = findAnchor(editor, shape, bounds)
		if (anchor) described.anchor = anchor
	}
	return described
}

function textOf(editor: Editor, shape: TLShape): string | undefined {
	const props = shape.props as Partial<{ richText: TLRichText; name: string }>
	let text: string | undefined
	if (isQuestionCard(shape)) text = shape.props.question
	else if (isPrototypeFrame(shape)) {
		text = [shape.props.label, shape.props.caption].filter(Boolean).join('\n')
	} else if (props.richText) {
		text = renderPlaintextFromRichText(editor, props.richText)
		// Claude's note starts with its "Claude" label (ADR 0026); the note's text is the rest.
		if (agentNoteMeta(shape.meta)) text = text.replace(new RegExp(`^${AGENT_NOTE_LABEL}\\n?`), '')
	} else if (typeof props.name === 'string') text = props.name
	text = text?.trim()
	if (!text) return undefined
	return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…` : text
}

function questionOf(card: QuestionCardShape): NonNullable<CanvasShape['question']> {
	const { options, recommendation } = card.props
	const answer = answerOf(card)
	const question: NonNullable<CanvasShape['question']> = { options, recommendation }
	if (answer?.kind === 'option') question.answer = options[answer.option] ?? ''
	if (answer?.kind === 'keep_grilling') question.answer = 'Keep grilling'
	if (answer?.kind === 'note') question.answer = `note: ${answer.text}`
	return question
}

function statusOfColor(color: string | undefined): DecisionStatus | undefined {
	return (Object.keys(STATUS_COLOR) as DecisionStatus[]).find(
		(status) => STATUS_COLOR[status] === color,
	)
}

/** Claude's shapes a user shape can annotate. */
const ANCHOR_ROLES: ReadonlySet<string> = new Set([
	'decision_node',
	'question_card',
	'diagram_node',
	'diagram_frame',
	'prototype_frame',
])

/**
 * The decision node, question card, diagram node, diagram frame or prototype
 * frame a user shape annotates: one it overlaps (the smallest, being the most specific, so
 * a node wins over its frame), else the nearest within {@link ANCHOR_REACH}.
 * Arrows bound to a Claude shape anchor to it.
 */
function findAnchor(editor: Editor, shape: TLShape, bounds: Box): ShapeAnchor | undefined {
	const isTarget = (target: TLShape | undefined): target is TLShape =>
		target !== undefined && ANCHOR_ROLES.has(roleOf(target))
	if (shape.type === 'arrow') {
		// The pointed-at end wins over the tail.
		const bindings = editor
			.getBindingsFromShape<TLArrowBinding>(shape.id, 'arrow')
			.sort((a, b) => Number(a.props.terminal === 'start') - Number(b.props.terminal === 'start'))
		for (const binding of bindings) {
			const target = editor.getShape(binding.toId)
			if (isTarget(target)) return anchorTo(editor, target, 'on')
		}
	}
	const targets = editor
		.getCurrentPageShapes()
		.filter(isTarget)
		.flatMap((target) => {
			const targetBounds = editor.getShapePageBounds(target.id)
			return targetBounds ? [{ target, targetBounds }] : []
		})

	let best: { target: TLShape; relation: ShapeAnchor['relation']; score: number } | undefined
	for (const { target, targetBounds } of targets) {
		const overlap = Box.Collides(bounds, targetBounds)
		const score = overlap ? targetBounds.w * targetBounds.h : gap(bounds, targetBounds)
		if (!overlap && score > ANCHOR_REACH) continue
		const relation = overlap ? 'on' : 'next_to'
		if (
			!best ||
			(relation === 'on' && best.relation === 'next_to') ||
			(relation === best.relation && score < best.score)
		) {
			best = { target, relation, score }
		}
	}
	return best && anchorTo(editor, best.target, best.relation, bounds)
}

function anchorTo(
	editor: Editor,
	target: TLShape,
	relation: ShapeAnchor['relation'],
	annotation?: Box,
): ShapeAnchor {
	const anchor: ShapeAnchor = {
		shapeId: target.id,
		role: roleOf(target),
		relation,
		label: textOf(editor, target)?.split('\n')[0] ?? '',
	}
	if (annotation && isPrototypeFrame(target)) {
		const inPrototype = placeInPrototype(editor, target, annotation)
		if (inPrototype) anchor.inPrototype = inPrototype
	}
	return anchor
}

/**
 * Where an annotation lies over a prototype's viewport (ADR 0017), in the
 * prototype's CSS pixels: the page units of the frame below its title bar
 * map 1:1 to the iframe's pixels. Undefined when it misses the viewport.
 */
function placeInPrototype(
	editor: Editor,
	frame: Parameters<typeof viewportOf>[0],
	annotation: Box,
): ShapeAnchor['inPrototype'] {
	const bounds = editor.getShapePageBounds(frame.id)
	if (!bounds) return undefined
	const { width, height } = viewportOf(frame)
	if (width === 0 || height === 0) return undefined
	const viewport = new Box(bounds.x, bounds.y + PROTOTYPE_HEADER_HEIGHT, width, height)
	const minX = Math.max(annotation.minX, viewport.minX)
	const minY = Math.max(annotation.minY, viewport.minY)
	const maxX = Math.min(annotation.maxX, viewport.maxX)
	const maxY = Math.min(annotation.maxY, viewport.maxY)
	if (maxX < minX || maxY < minY) return undefined
	return {
		x: Math.round(minX - viewport.x),
		y: Math.round(minY - viewport.y),
		w: Math.round(maxX - minX),
		h: Math.round(maxY - minY),
	}
}

/** Distance between two boxes; 0 when they touch or overlap. */
function gap(a: Box, b: Box): number {
	const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX)
	const dy = Math.max(0, a.minY - b.maxY, b.minY - a.maxY)
	return Math.hypot(dx, dy)
}

function toPageBox(box: Box): PageBox {
	return {
		x: Math.round(box.x),
		y: Math.round(box.y),
		w: Math.max(1, Math.round(box.w)),
		h: Math.max(1, Math.round(box.h)),
	}
}
