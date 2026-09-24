import type { ShapeRole } from '@tldraw-code/protocol'
import type { TLShape } from 'tldraw'
import { QUESTION_CARD_TYPE } from '../ask/QuestionCardShapeUtil'
import { graphMeta } from '../graph/renderGraph'

const ROLE_BY_TYPE: Record<string, ShapeRole> = {
	[QUESTION_CARD_TYPE]: 'question_card',
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

/**
 * What a shape means in the session (ADR 0008). Shapes drawn by Claude's
 * tools carry a domain role; everything else is named by its look.
 */
export function roleOf(shape: TLShape): ShapeRole {
	const graph = graphMeta(shape.meta)
	if (graph) return graph.graphPart === 'node' ? 'decision_node' : 'dependency'
	return ROLE_BY_TYPE[shape.type] ?? 'other'
}

const CLAUDE_ROLES: ReadonlySet<ShapeRole> = new Set([
	'decision_node',
	'dependency',
	'question_card',
])

/** Marker in `shape.meta` of shapes a canvas tool drew without a domain role (e.g. the smoke test). */
export const CLAUDE_META = { createdBy: 'claude' } as const

/** Whether the shape was put on the canvas by one of Claude's tools rather than by the user. */
export function isClaudeShape(shape: TLShape): boolean {
	return CLAUDE_ROLES.has(roleOf(shape)) || shape.meta.createdBy === CLAUDE_META.createdBy
}
