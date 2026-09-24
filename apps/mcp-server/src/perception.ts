import type {
	CanvasActivity,
	CanvasCommandResult,
	CanvasRegion,
	CanvasShape,
	PageBox,
	ShapeRole,
} from '@tldraw-code/protocol'
import { isActivityEmpty } from '@tldraw-code/protocol'
import type { CanvasBridge } from './bridge'

type ReadResult = CanvasCommandResult<'canvas.read'>

const ROLE_NAMES: Record<ShapeRole, [singular: string, plural: string]> = {
	decision_node: ['decision node', 'decision nodes'],
	dependency: ['dependency', 'dependencies'],
	question_card: ['question card', 'question cards'],
	diagram_frame: ['diagram frame', 'diagram frames'],
	diagram_node: ['diagram node', 'diagram nodes'],
	diagram_edge: ['diagram edge', 'diagram edges'],
	prototype_frame: ['prototype', 'prototypes'],
	sticky_note: ['sticky note', 'sticky notes'],
	drawing: ['drawing', 'drawings'],
	text: ['text', 'texts'],
	geo: ['geo shape', 'geo shapes'],
	arrow: ['arrow', 'arrows'],
	line: ['line', 'lines'],
	frame: ['frame', 'frames'],
	image: ['image', 'images'],
	other: ['other shape', 'other shapes'],
}

/**
 * The text part of a `read_canvas` result (ADR 0008): the region, then the
 * user's shapes (what Claude has not drawn itself) with what they annotate,
 * then Claude's own shapes. The screenshot travels as a separate image block.
 */
export function describeRead(region: CanvasRegion, result: ReadResult): string {
	if (!result.region) return 'The canvas is empty: there are no shapes on the page.'
	const regionName = typeof region === 'string' ? region : 'box'
	const count = result.shapes.length + result.omitted
	const lines = [
		`Read region "${regionName}" = ${describeBox(result.region)} (page units): ${count} shape${count === 1 ? '' : 's'}.`,
	]
	if (result.screenshot) {
		lines.push(
			`Screenshot of the region attached (${result.screenshot.width} x ${result.screenshot.height} px).`,
		)
	} else if (result.screenshotError) {
		lines.push(`No screenshot: ${result.screenshotError}.`)
	}
	const user = result.shapes.filter((shape) => shape.owner === 'user')
	const claude = result.shapes.filter((shape) => shape.owner === 'claude')
	lines.push('', `User's shapes (not drawn by your tools): ${user.length}`)
	for (const shape of user) lines.push(`- ${describeShape(shape)}`)
	lines.push('', `Your shapes: ${claude.length}`)
	for (const shape of claude) lines.push(`- ${describeShape(shape)}`)
	if (result.omitted > 0) {
		lines.push(
			'',
			`${result.omitted} more shapes are not listed; read a smaller region to see them.`,
		)
	}
	return lines.join('\n')
}

function describeShape(shape: CanvasShape): string {
	const parts = [shape.role === 'geo' && shape.geo ? shape.geo : ROLE_NAMES[shape.role][0]]
	if (shape.role === 'decision_node' && shape.decisionId) parts.push(`"${shape.decisionId}"`)
	if (shape.role === 'dependency' && shape.decisionId) parts.push(shape.decisionId)
	if (shape.diagram) {
		const { kind, id, frame, element, differs } = shape.diagram
		if (element) parts.push(shape.role === 'diagram_node' ? `"${element}"` : element)
		parts.push(`in ${kind} "${id}" / "${frame}"${differs ? ' [differs]' : ''}`)
	}
	if (shape.prototype) {
		const { id, iterationOf, width, height } = shape.prototype
		parts.push(`"${id}"`)
		if (iterationOf) parts.push(`(iteration of "${iterationOf}")`)
		parts.push(`viewport ${width} x ${height} px`)
	}
	// A diagram frame's text is its title, already named above.
	if (shape.text && shape.role !== 'diagram_frame') parts.push(JSON.stringify(shape.text))
	if (shape.status) parts.push(`[${shape.status}${shape.onFrontier ? ', frontier' : ''}]`)
	if (shape.question) {
		const options = shape.question.options.map((option, index) =>
			index === shape.question?.recommendation ? `${option} (recommended)` : option,
		)
		parts.push(`options: ${options.join(', ')};`)
		parts.push(`answer: ${shape.question.answer ?? 'none yet'}`)
	}
	if (shape.color && shape.owner === 'user') parts.push(`(${shape.color})`)
	if (shape.role === 'arrow' && (shape.fromShapeId || shape.toShapeId)) {
		parts.push(`from ${shape.fromShapeId ?? 'nowhere'} to ${shape.toShapeId ?? 'nowhere'}`)
	}
	if (shape.anchor) {
		const relation = shape.anchor.relation === 'on' ? 'on' : 'next to'
		parts.push(
			`${relation} ${ROLE_NAMES[shape.anchor.role][0]} ${JSON.stringify(shape.anchor.label)} (${shape.anchor.shapeId})`,
		)
		const inside = shape.anchor.inPrototype
		if (inside) parts.push(`over its ${describeBox(inside)} (prototype px)`)
	}
	if (shape.frameId) parts.push(`in frame ${shape.frameId}`)
	parts.push(`· ${shape.id} at ${describeBox(shape.bounds)}`)
	return parts.join(' ')
}

function describeBox({ x, y, w, h }: PageBox): string {
	return `x ${x}, y ${y}, ${w} x ${h}`
}

/**
 * One line summing up what the user did on the canvas since Claude last
 * read it (ADR 0009), or undefined when nothing happened.
 */
export function describeActivity(activity: CanvasActivity): string | undefined {
	if (isActivityEmpty(activity)) return undefined
	const parts: string[] = []
	const added = Object.entries(activity.added) as [ShapeRole, number][]
	if (added.length > 0) {
		const items = added.map(([role, count]) => `${count} ${ROLE_NAMES[role][count === 1 ? 0 : 1]}`)
		parts.push(`added ${items.join(', ')}`)
	}
	if (activity.changed > 0) {
		parts.push(`moved or edited ${activity.changed} shape${activity.changed === 1 ? '' : 's'}`)
	}
	if (activity.removed > 0) {
		parts.push(`deleted ${activity.removed} shape${activity.removed === 1 ? '' : 's'}`)
	}
	return `Canvas activity since your last read_canvas: the user ${parts.join('; ')}. Call read_canvas to see it.`
}

/**
 * The activity line for the end of a tool result, fetched from the canvas.
 * Best effort: without a connected canvas (or on any bridge error) there is
 * nothing to report and the tool result stays as it is.
 */
export async function fetchActivityNote(bridge: CanvasBridge): Promise<string | undefined> {
	if (!bridge.isConnected()) return undefined
	try {
		return describeActivity(await bridge.request('canvas.activity', {}))
	} catch {
		return undefined
	}
}
