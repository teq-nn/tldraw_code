import { z } from 'zod'
import { DecisionNodeSchema, DependencyEdgeSchema } from './graph'

const renderCounts = z.object({
	created: z.number().int().nonnegative(),
	updated: z.number().int().nonnegative(),
	removed: z.number().int().nonnegative(),
})

/**
 * Catalog of commands the MCP server can send to the canvas. Each entry pairs
 * the payload schema with the schema of the result the canvas answers with.
 * Later tickets (ask, read_canvas, ...) add entries here.
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
