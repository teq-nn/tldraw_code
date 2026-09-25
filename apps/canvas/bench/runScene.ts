import type {
	CanvasCommandName,
	CanvasCommandPayload,
	CanvasCommandResult,
	CanvasShape,
	PageBox,
} from '@tldraw-code/protocol'
import { Box, type Editor, serializeTldrawJson, type TLShapeId } from 'tldraw'
import { watchQuestionCards } from '../src/ask/watchQuestionCards'
import type { LayoutFlavour } from '../src/bridge/layoutFlavours'
import { hideCollapsedContent } from '../src/comparison/comparisonFrames'
import { isClaudeShape } from '../src/perception/shapeRoles'
import { createTestEditor } from '../test/createTestEditor'
import { union, visibleFraction } from './metrics'
import type { Scene, SceneContext } from './scene'

/** The browser window the scene is watched in: a common laptop screen. */
const SCREEN = new Box(0, 0, 1440, 900)

export interface CallRecord {
	command: CanvasCommandName
	/** Share of what the command drew or moved that is in the viewport afterwards; undefined when nothing changed. */
	viewportFit?: number
}

/** What the canvas looked like after one step of the scene. */
export interface StepRecord {
	name: string
	/** Every shape on the page, as `read_canvas` describes it (role, owner, bounds, anchor). */
	shapes: CanvasShape[]
	viewport: PageBox
	zoom: number
	calls: CallRecord[]
	/** Ids of the user's shapes that one of Claude's commands moved. */
	userShapesMoved: string[]
	/** Bounds of the step's new content and of what it is about. */
	focus?: { content: PageBox; subject: PageBox }
	/** The canvas after this step as a `.tldr` file, for the layout demo. */
	snapshot: string
}

export interface SceneRun {
	/** The run's name: its flavour's, or a variant's such as `user-owned+tidy`. */
	flavour: string
	steps: StepRecord[]
	/** The final canvas as a `.tldr` file. */
	snapshot: string
}

/**
 * Replay the scene against a headless editor running the flavour's command
 * handlers, as the canvas app wires them (question cards watched for note
 * answers, collapsed content hidden), and record the canvas after every step.
 * The run goes by `name`, the flavour's own by default.
 */
export async function runScene(
	flavour: LayoutFlavour,
	scene: Scene,
	name = flavour.name,
): Promise<SceneRun> {
	const editor = createTestEditor({ getShapeVisibility: hideCollapsedContent })
	editor.updateViewportScreenBounds(SCREEN)
	const handlers = flavour.createHandlers(editor, {
		capture: async () => {
			throw new Error('The layout benchmark takes no screenshots.')
		},
	})
	const stopWatching = watchQuestionCards(editor, () => {})
	try {
		const steps: StepRecord[] = []
		for (const step of scene.steps) {
			const calls: CallRecord[] = []
			const userShapesMoved = new Set<string>()
			const claude = async <N extends CanvasCommandName>(
				command: N,
				payload: CanvasCommandPayload<N>,
			): Promise<CanvasCommandResult<N>> => {
				const handler = handlers[command] as (
					payload: CanvasCommandPayload<N>,
				) => CanvasCommandResult<N> | Promise<CanvasCommandResult<N>>
				const before = placements(editor)
				const result = await handler(payload)
				const after = placements(editor)
				for (const id of userShapesMovedBy(before, after)) userShapesMoved.add(id)
				const content = union(claudeContentOf(before, after))
				const viewport = toPageBox(editor.getViewportPageBounds())
				calls.push({
					command,
					...(content ? { viewportFit: visibleFraction(content, viewport) } : {}),
				})
				return result
			}
			const context: SceneContext = { editor, claude }
			await step.run(context)
			const read = await handlers['canvas.read']({ region: 'all', screenshot: false })
			const focus = step.focus?.(editor)
			const content = focus && boundsOf(editor, focus.content)
			const subject = focus && boundsOf(editor, focus.subject)
			steps.push({
				name: step.name,
				shapes: read.shapes,
				viewport: toPageBox(editor.getViewportPageBounds()),
				zoom: editor.getZoomLevel(),
				calls,
				userShapesMoved: [...userShapesMoved],
				...(content && subject ? { focus: { content, subject } } : {}),
				snapshot: await serializeTldrawJson(editor),
			})
		}
		return {
			flavour: name,
			steps,
			snapshot: steps.at(-1)?.snapshot ?? (await serializeTldrawJson(editor)),
		}
	} finally {
		stopWatching()
		editor.dispose()
	}
}

interface Placement {
	owner: 'claude' | 'user'
	/** Arrows follow the shapes they connect; they take no room of their own. */
	connector: boolean
	/** The shape's own position on the page. */
	point: { x: number; y: number }
	bounds: PageBox
}

function placements(editor: Editor): Map<TLShapeId, Placement> {
	return new Map(
		editor.getCurrentPageShapes().flatMap((shape) => {
			const bounds = editor.getShapePageBounds(shape.id)
			if (!bounds) return []
			const { x, y } = editor.getShapePageTransform(shape).point()
			const placement: Placement = {
				owner: isClaudeShape(shape) ? 'claude' : 'user',
				connector: shape.type === 'arrow',
				point: { x, y },
				bounds: toPageBox(bounds),
			}
			return [[shape.id, placement] as const]
		}),
	)
}

/**
 * The user's shapes whose position a command changed. An arrow whose ends
 * follow the shapes it is bound to has not been moved; a removed shape (the
 * note that answered a collapsed card, ADR 0010) is not counted either.
 */
function userShapesMovedBy(
	before: Map<TLShapeId, Placement>,
	after: Map<TLShapeId, Placement>,
): TLShapeId[] {
	return [...after].flatMap(([id, now]) => {
		const was = before.get(id)
		if (now.owner !== 'user' || !was) return []
		return was.point.x !== now.point.x || was.point.y !== now.point.y ? [id] : []
	})
}

/** Bounds of Claude's shapes a command drew, moved or resized, arrows aside. */
function claudeContentOf(
	before: Map<TLShapeId, Placement>,
	after: Map<TLShapeId, Placement>,
): PageBox[] {
	return [...after].flatMap(([id, now]) => {
		if (now.owner !== 'claude' || now.connector) return []
		const was = before.get(id)?.bounds
		const same = was && (['x', 'y', 'w', 'h'] as const).every((key) => was[key] === now.bounds[key])
		return same ? [] : [now.bounds]
	})
}

function boundsOf(editor: Editor, ids: TLShapeId[]): PageBox | undefined {
	const bounds = ids.length > 0 ? editor.getShapesPageBounds(ids) : undefined
	return bounds ? toPageBox(bounds) : undefined
}

function toPageBox(box: Box): PageBox {
	return { x: box.x, y: box.y, w: box.w, h: box.h }
}
