import type { ShapeRole } from '@tldraw-code/protocol'
import type { TLShape } from 'tldraw'
import { QUESTION_CARD_TYPE } from '../ask/QuestionCardShapeUtil'
import { choicePinMeta } from '../comparison/comparisonFrames'
import { diagramMeta } from '../diagram/renderDiagrams'
import { graphMeta } from '../graph/renderGraph'
import { agentNoteMeta } from '../note/renderNote'
import { PROTOTYPE_FRAME_TYPE } from '../prototype/PrototypeShapeUtil'

const ROLE_BY_TYPE: Record<string, ShapeRole> = {
	[QUESTION_CARD_TYPE]: 'question_card',
	[PROTOTYPE_FRAME_TYPE]: 'prototype_frame',
	note: 'sticky_note',
	draw: 'drawing',
	highlight: 'drawing',
	text: 'text',
	geo: 'geo',
	arrow: 'arrow',
	line: 'line',
	frame: 'frame',
	image: 'image',
	video: 'image',
}

/** Captions are plain text in a diagram frame. */
const DIAGRAM_ROLES = {
	frame: 'diagram_frame',
	node: 'diagram_node',
	edge: 'diagram_edge',
	caption: 'text',
} as const satisfies Record<string, ShapeRole>

/**
 * What a shape means in the session (ADR 0008). Shapes drawn by Claude's
 * tools carry a domain role; everything else is named by its look.
 */
export function roleOf(shape: TLShape): ShapeRole {
	const graph = graphMeta(shape.meta)
	if (graph) return graph.graphPart === 'node' ? 'decision_node' : 'dependency'
	const diagram = diagramMeta(shape.meta)
	if (diagram) return DIAGRAM_ROLES[diagram.diagramPart]
	if (choicePinMeta(shape.meta)) return 'choice_pin'
	if (agentNoteMeta(shape.meta)) return 'agent_note'
	return ROLE_BY_TYPE[shape.type] ?? 'other'
}

const CLAUDE_ROLES: ReadonlySet<ShapeRole> = new Set([
	'decision_node',
	'dependency',
	'question_card',
	'diagram_frame',
	'diagram_node',
	'diagram_edge',
	'prototype_frame',
	'choice_pin',
	'agent_note',
])

/** Marker in `shape.meta` of shapes a canvas tool drew without a domain role (e.g. the smoke test). */
export const CLAUDE_META = { createdBy: 'claude' } as const

/** Whether the shape was put on the canvas by one of Claude's tools rather than by the user. */
export function isClaudeShape(shape: TLShape): boolean {
	return (
		CLAUDE_ROLES.has(roleOf(shape)) ||
		diagramMeta(shape.meta) !== undefined ||
		shape.meta.createdBy === CLAUDE_META.createdBy
	)
}
