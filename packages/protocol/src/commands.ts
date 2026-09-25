import { z } from 'zod'
import { AskAnswerSchema, AskIdSchema, QuestionShape } from './ask'
import {
	CanvasActivitySchema,
	CanvasRegionSchema,
	CanvasScreenshotSchema,
	CanvasShapeSchema,
	PageBoxSchema,
} from './canvas'
import { SettleComparisonShape } from './compare'
import { DiagramEdgeSchema, DiagramIdSchema, DiagramNodeSchema, MAX_COMPARE_ITEMS } from './diagram'
import { DecisionNodeSchema, DependencyEdgeSchema } from './graph'
import { NoteIdSchema, RenderNoteShape } from './note'
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
			/**
			 * The prototype is alternative `index` of the comparison `id` (`compare`,
			 * ADR 0020): a new one goes right of alternative `index - 1`, the first to
			 * the right of the page content, and the question card goes below them.
			 */
			comparison: z
				.object({
					id: DiagramIdSchema,
					index: z
						.number()
						.int()
						.min(0)
						.max(MAX_COMPARE_ITEMS - 1),
				})
				.optional(),
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
	 * Settle a comparison after the user chose (ADR 0021): mark the chosen
	 * alternative and pin it to its decision node with an arrow; collapse every
	 * other alternative to its title bar, dimmed, with the reason it lost.
	 * Idempotent; settling again with another choice re-opens the old one.
	 */
	'comparison.settle': {
		payload: z.object({
			id: SettleComparisonShape.id,
			chosen: SettleComparisonShape.chosen,
			rejected: SettleComparisonShape.rejected,
			/** Decision node id to pin the chosen alternative to. */
			node: DiagramIdSchema,
		}),
		result: z.object({
			kind: z.enum(['diagram', 'prototype']),
			/** Shape id of the chosen alternative's frame. */
			chosenFrameId: z.string(),
			/** Shape ids of the collapsed frames, in row order. */
			rejectedFrameIds: z.array(z.string()),
			/** Shape id of the arrow from the decision node, or null when the node is not on the canvas. */
			pinId: z.string().nullable(),
		}),
	},
	/**
	 * Put Claude's note on the canvas (ADR 0026), right next to `replyTo` or to
	 * the right of everything. Keyed by `id` when given: a repeated call updates
	 * that note in place. Not user activity.
	 */
	'note.render': {
		payload: z.object({
			text: RenderNoteShape.text,
			replyTo: RenderNoteShape.replyTo,
			id: NoteIdSchema.optional(),
		}),
		result: z.object({
			shapeId: z.string(),
			/** False when an existing note with this id was updated. */
			created: z.boolean(),
			/** Shape id of the note it was placed next to, when `replyTo` was given. */
			replyToShapeId: z.string().optional(),
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
	/**
	 * The user changed the canvas and then paused (ADR 0024): everything they
	 * did since Claude last read the canvas, so the server can push it into
	 * the session as a channel event. Sent after a quiet period, never while
	 * the user is still typing into a shape.
	 */
	'canvas.activity': CanvasActivitySchema,
} as const

export type CanvasEventName = keyof typeof canvasEvents
export type CanvasEventPayload<N extends CanvasEventName> = z.infer<(typeof canvasEvents)[N]>

/** Catalog of events the server sends to the canvas without being asked. */
export const serverEvents = {
	/**
	 * Claude is (or is no longer) working on a channel push (ADR 0025), so the
	 * canvas can show it. The server owns the state; the canvas only displays it.
	 */
	'agent.working': z.object({
		working: z.boolean(),
	}),
} as const

export type ServerEventName = keyof typeof serverEvents
export type ServerEventPayload<N extends ServerEventName> = z.infer<(typeof serverEvents)[N]>

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

/**
 * Path the bridge accepts a POST on when Claude Code's turn has ended (ADR 0025).
 * A Claude Code `Stop` hook calls it; the bridge answers 204.
 */
export const AGENT_STOP_PATH = '/agent/stop'

/** Default port of the bridge's WebSocket server. Override with CANVAS_BRIDGE_PORT. */
export const DEFAULT_BRIDGE_PORT = 4477
