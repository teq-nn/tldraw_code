import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
	type AskAnswer,
	type CanvasCommandResult,
	computeFrontier,
	FrontierGraphSchema,
	FrontierGraphShape,
	KEEP_GRILLING_LABEL,
	type Question,
	QuestionSchema,
	QuestionShape,
} from '@tldraw-code/protocol'
import type { ZodError } from 'zod'
import { z } from 'zod'
import { AskCoordinator, type AskOutcome, type AskTimings, DEFAULT_ASK_TIMINGS } from './ask'
import { type CanvasBridge, CanvasBridgeError } from './bridge'
import { ToolInputError } from './errors'

export const SERVER_NAME = 'tldraw-canvas'
export const SERVER_VERSION = '0.0.0'

/**
 * Build the MCP server with all canvas tools registered. Transport-agnostic:
 * `main.ts` connects it to stdio, tests connect it to an in-memory transport.
 */
export interface McpServerOptions {
	/** Timeout and heartbeat of `ask` (ADR 0006). */
	ask?: Partial<AskTimings>
	/** Diagnostic logger; must not write to stdout. */
	log?: (message: string) => void
}

export function createMcpServer(bridge: CanvasBridge, options: McpServerOptions = {}): McpServer {
	const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION })
	const askTimings = { ...DEFAULT_ASK_TIMINGS, ...options.ask }
	const asks = new AskCoordinator(bridge, askTimings, options.log)

	server.registerTool(
		'canvas_smoke_test',
		{
			title: 'Canvas smoke test',
			description:
				'Create one labelled rectangle in the middle of the open tldraw canvas to verify that the MCP server can reach the canvas.',
			inputSchema: {
				text: z
					.string()
					.min(1)
					.max(200)
					.optional()
					.describe('Label for the shape. Defaults to "Hello from Claude Code".'),
			},
		},
		async ({ text }) =>
			toToolResult(async () => {
				const { shapeId } = await bridge.request('smoke.create_shape', {
					text: text ?? 'Hello from Claude Code',
				})
				return `Created shape ${shapeId} on the canvas.`
			}),
	)

	server.registerTool(
		'render_graph',
		{
			title: 'Render frontier graph',
			description:
				'Draw or update the decision graph on the canvas. Pass the whole graph every time: ' +
				'decision nodes (stable id, short title, status open/resolved/blocked, optional one-line note) ' +
				'and dependency edges {from, to} meaning "from must be resolved before to". ' +
				'Layout, status colours and the frontier (open nodes whose blockers are all resolved, highlighted) ' +
				'are computed for you. Nodes and edges are matched by id: existing shapes are updated, ' +
				'new ones added, and ones missing from this call removed.',
			inputSchema: FrontierGraphShape,
		},
		async (args) =>
			toToolResult(async () => {
				const parsed = FrontierGraphSchema.safeParse(args)
				if (!parsed.success) throw new ToolInputError('invalid_graph', describeIssues(parsed.error))
				const graph = parsed.data
				const frontier = computeFrontier(graph)
				const result = await bridge.request('graph.render', { ...graph, frontier })
				return describeRender(graph.nodes.length, graph.edges.length, frontier, result)
			}),
	)

	server.registerTool(
		'ask',
		{
			title: 'Ask the user on the canvas',
			description:
				'Put one question to the user as a question card on the canvas and wait for the answer. ' +
				'Give one short sentence, 2 to 4 short options and your recommendation (one of the options, ' +
				`it is marked on the card). The card also has a "${KEEP_GRILLING_LABEL}" button, and the user ` +
				'may answer freely with a sticky note next to the card. Blocks until the user answers ' +
				`(up to ${formatDuration(askTimings.timeoutMs)}); then returns "no answer yet" and the card ` +
				'stays open: call ask again with the same arguments to keep waiting. Only one question at a time; ' +
				'a different question replaces the open card.',
			inputSchema: QuestionShape,
		},
		async (args, extra) =>
			toToolResult(async () => {
				const parsed = QuestionSchema.safeParse(args)
				if (!parsed.success) {
					throw new ToolInputError('invalid_question', describeIssues(parsed.error))
				}
				const progressToken = extra._meta?.progressToken
				const outcome = await asks.ask(parsed.data, {
					signal: extra.signal,
					onHeartbeat:
						progressToken === undefined
							? undefined
							: (waitedMs) =>
									void extra
										.sendNotification({
											method: 'notifications/progress',
											params: {
												progressToken,
												progress: Math.round(waitedMs / 1000),
												message: 'Waiting for the answer on the canvas',
											},
										})
										.catch(() => {}),
				})
				return describeAskOutcome(parsed.data, outcome, askTimings.timeoutMs)
			}),
	)

	return server
}

function describeAskOutcome(question: Question, outcome: AskOutcome, timeoutMs: number): string {
	switch (outcome.kind) {
		case 'answered':
			return describeAnswer(question, outcome.answer)
		case 'timeout':
			return (
				`No answer yet: the user has not answered within ${formatDuration(timeoutMs)}. ` +
				'The question card stays open on the canvas. To keep waiting, call ask again with exactly ' +
				'the same question, options and recommendation; an answer given in the meantime is returned at once.'
			)
		case 'cancelled':
			return 'The ask call was cancelled. The question card stays open on the canvas.'
	}
}

function describeAnswer(question: Question, answer: AskAnswer): string {
	switch (answer.kind) {
		case 'option': {
			const option = question.options[answer.option]
			const recommended = option === question.recommendation ? ' (your recommendation)' : ''
			return `The user chose: ${option}${recommended}.`
		}
		case 'keep_grilling':
			return `The user chose "${KEEP_GRILLING_LABEL}": do not decide yet. Dig deeper into this question, e.g. with a narrower follow-up question.`
		case 'note':
			return `The user answered with a sticky note instead of an option: "${answer.text}"`
	}
}

function formatDuration(ms: number): string {
	if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} min`
	if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000} s`
	return `${ms} ms`
}

function describeIssues(error: ZodError): string {
	return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
}

function describeRender(
	nodeCount: number,
	edgeCount: number,
	frontier: string[],
	{ nodes, edges }: CanvasCommandResult<'graph.render'>,
): string {
	const counts = (c: typeof nodes) => `${c.created} new, ${c.updated} updated, ${c.removed} removed`
	return [
		`Rendered ${nodeCount} decision nodes (${counts(nodes)}) and ${edgeCount} edges (${counts(edges)}).`,
		`Frontier: ${frontier.length > 0 ? frontier.join(', ') : '(empty)'}.`,
	].join('\n')
}

async function toToolResult(run: () => Promise<string>): Promise<CallToolResult> {
	try {
		return { content: [{ type: 'text', text: await run() }] }
	} catch (error) {
		if (error instanceof CanvasBridgeError || error instanceof ToolInputError) {
			return {
				isError: true,
				content: [{ type: 'text', text: `[${error.code}] ${error.message}` }],
			}
		}
		throw error
	}
}
