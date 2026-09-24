import { z } from 'zod'
import { AskAnswerSchema, AskIdSchema, QuestionShape } from './ask'
import {
	CanvasActivitySchema,
	CanvasRegionSchema,
	CanvasScreenshotSchema,
	CanvasShapeSchema,
	PageBoxSchema,
} from './canvas'
import { DecisionNodeSchema, DependencyEdgeSchema } from './graph'

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
		}),
		result: z.object({
			nodes: renderCounts,
			edges: renderCounts,
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
		}),
		result: z.object({
			shapeId: z.string(),
			/** False when an existing card for this askId was kept. */
			created: z.boolean(),
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
