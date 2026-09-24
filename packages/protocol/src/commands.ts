import { z } from 'zod'
import { AskAnswerSchema, AskIdSchema, QuestionShape } from './ask'
import {
	CanvasActivitySchema,
	CanvasRegionSchema,
	CanvasScreenshotSchema,
	CanvasShapeSchema,
	PageBoxSchema,
} from './canvas'
import { DiagramEdgeSchema, DiagramIdSchema, DiagramNodeSchema, MAX_COMPARE_ITEMS } from './diagram'
import { DecisionNodeSchema, DependencyEdgeSchema } from './graph'
import { PrototypeIdSchema, RenderPrototypeShape } from './prototype'

const renderCounts = z.object({
	created: z.number().int().nonnegative(),
	updated: z.number().int().nonnegative(),
	removed: z.number().int().nonnegative(),
})

/**
 * Catalog of commands the MCP server can send to the canvas. Each entry pairs
 * the payload schema with the schema of the result the canvas answers with.
 * New canvas tools add entries here.
 */
export const canvasCommands = {
	/** Smoke test: create one visible shape so the bridge can be verified end to end. */
	'smoke.create_shape': {
		payload: z.object({
			text: z.string().min(1).max(200),
		}),
		result: z.object({
			shapeId: z.string(),
		}),
	},
	/**
	 * Render or update the frontier graph (ADR 0005). The server has validated
	 * the graph and computed the frontier; the canvas lays it out and draws it,
	 * reusing the shapes of earlier renders.
	 */
	'graph.render': {
		payload: z.object({
			nodes: z.array(DecisionNodeSchema),
			edges: z.array(DependencyEdgeSchema),
			/** Ids of the nodes on the frontier, to be highlighted. */
			frontier: z.array(z.string()),
			/**
			 * The question card whose answer Claude has received (ADR 0010). If
			 * it is still on the canvas and answered, it is removed in the same
			 * undo step: the graph, with the answer as a node's note, replaces it.
			 */
			collapseQuestion: AskIdSchema.optional(),
		}),
		result: z.object({
			nodes: renderCounts,
			edges: renderCounts,
			/** Whether the answered question card named in `collapseQuestion` was removed. */
			questionCollapsed: z.boolean().default(false),
		}),
	},
	/**
	 * Show the question card for `askId` (ADR 0006). Idempotent: if the card
	 * already exists it is kept as is (including an answer given meanwhile).
	 * Any other question card is removed, so only one is ever on the canvas.
	 * Returns at once; the answer arrives later as an `ask.answered` event.
	 */
	'ask.show': {
		payload: z.object({
			askId: AskIdSchema,
			question: QuestionShape.question,
			options: QuestionShape.options,
			/** Index of Claude's recommendation in `options`. */
			recommendation: z.number().int().nonnegative(),
			/**
			 * Place a new card below the frames of this comparison (`compare`,
			 * ADR 0015) instead of below the frontier graph.
			 */
			comparison: DiagramIdSchema.optional(),
		}),
		result: z.object({
			shapeId: z.string(),
			/** False when an existing card for this askId was kept. */
			created: z.boolean(),
		}),
	},
	/**
	 * Render or update diagrams in frames side by side (ADR 0015): one frame
	 * for `render_diagram`, 2 or 3 for `compare`. The frames share one layout
	 * in the house style of the frontier graph, so an element common to the
	 * alternatives sits in the same place in every frame. Keyed by `kind` and
	 * `id`: a repeated call updates the frames in place.
	 */
	'diagram.render': {
		payload: z.object({
			kind: z.enum(['diagram', 'comparison']),
			id: DiagramIdSchema,
			frames: z
				.array(
					z.object({
						title: z.string().min(1),
						/** One line shown at the top of the frame. */
						caption: z.string().optional(),
						nodes: z.array(DiagramNodeSchema),
						edges: z.array(DiagramEdgeSchema),
						/** Node ids and edge keys (`from->to`) to highlight as differences. */
						highlight: z.object({
							nodes: z.array(z.string()),
							edges: z.array(z.string()),
						}),
					}),
				)
				.min(1)
				.max(MAX_COMPARE_ITEMS),
		}),
		result: z.object({
			/** Shape ids of the frames, in order. */
			frameIds: z.array(z.string()),
			nodes: renderCounts,
			edges: renderCounts,
		}),
	},
	/**
	 * Show or update an HTML prototype in a sandboxed prototype frame
	 * (ADR 0016, ADR 0017). Keyed by `id`: a repeated call replaces the HTML
	 * in place. A new prototype with `iterationOf` goes right next to that
	 * prototype, any other new one to the right of the page content.
	 */
	'prototype.render': {
		payload: z.object({
			id: PrototypeIdSchema,
			label: RenderPrototypeShape.label,
			html: RenderPrototypeShape.html,
			caption: RenderPrototypeShape.caption,
			iterationOf: PrototypeIdSchema.optional(),
			width: RenderPrototypeShape.width,
			height: RenderPrototypeShape.height,
		}),
		result: z.object({
			shapeId: z.string(),
			/** False when an existing prototype frame with this id was updated. */
			created: z.boolean(),
			/** Page bounds of the whole frame (header plus viewport). */
			bounds: PageBoxSchema,
			/** Viewport size in CSS px after the render. */
			width: z.number(),
			height: z.number(),
			/** Shape id of the prototype this one iterates on, when given. */
			iterationOfShapeId: z.string().optional(),
		}),
	},
	/**
	 * Read a region of the canvas (ADR 0008): the shapes in it, described
	 * semantically, and optionally a screenshot of it. Resets the activity
	 * digest, since Claude has now seen the canvas.
	 */
	'canvas.read': {
		payload: z.object({
			region: CanvasRegionSchema,
			screenshot: z.boolean(),
		}),
		result: z.object({
			/** The page area that was read; null when the page is empty. */
			region: PageBoxSchema.nullable(),
			shapes: z.array(CanvasShapeSchema),
			/** Shapes in the region left out of `shapes` because of the size cap. */
			omitted: z.number().int().nonnegative(),
			screenshot: CanvasScreenshotSchema.nullable(),
			/** Why there is no screenshot, when one was asked for. */
			screenshotError: z.string().optional(),
		}),
	},
	/**
	 * What the user changed since the last `canvas.read` (ADR 0009), without
	 * resetting it. The server appends it to every tool result.
	 */
	'canvas.activity': {
		payload: z.object({}),
		result: CanvasActivitySchema,
	},
} as const

export type CanvasCommandName = keyof typeof canvasCommands
export type CanvasCommandPayload<N extends CanvasCommandName> = z.infer<
	(typeof canvasCommands)[N]['payload']
>
export type CanvasCommandResult<N extends CanvasCommandName> = z.infer<
	(typeof canvasCommands)[N]['result']
>

export function isCanvasCommandName(name: string): name is CanvasCommandName {
	return Object.hasOwn(canvasCommands, name)
}

/** Catalog of events the canvas can send to the server without being asked. */
export const canvasEvents = {
	/** Sent once right after the socket opens. */
	hello: z.object({
		client: z.literal('canvas'),
	}),
	/**
	 * The user answered the question card `askId`. Sent when the answer is
	 * given and again after every reconnect while the card is on the canvas;
	 * the server ignores answers it no longer waits for.
	 */
	'ask.answered': z.object({
		askId: AskIdSchema,
		answer: AskAnswerSchema,
	}),
} as const

export type CanvasEventName = keyof typeof canvasEvents
export type CanvasEventPayload<N extends CanvasEventName> = z.infer<(typeof canvasEvents)[N]>

/** Error codes that can appear in a failed result or a tool error. */
export const BridgeErrorCode = {
	/** No canvas tab is connected to the bridge. */
	NotConnected: 'not_connected',
	/** The canvas did not answer in time. */
	Timeout: 'timeout',
	/** The canvas does not know the command. */
	UnknownCommand: 'unknown_command',
	/** The payload failed validation. */
	InvalidPayload: 'invalid_payload',
	/** The command handler threw. */
	HandlerFailed: 'handler_failed',
	/** The canvas tab disconnected while the command was in flight. */
	Disconnected: 'disconnected',
	/** A newer canvas tab replaced this connection. */
	Replaced: 'replaced',
} as const

export type BridgeErrorCode = (typeof BridgeErrorCode)[keyof typeof BridgeErrorCode]

/** Default port of the bridge's WebSocket server. Override with CANVAS_BRIDGE_PORT. */
export const DEFAULT_BRIDGE_PORT = 4477
