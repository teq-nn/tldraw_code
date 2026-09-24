import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type {
	CallToolResult,
	ServerNotification,
	ServerRequest,
} from '@modelcontextprotocol/sdk/types.js'
import {
	type AlternativeDifferences,
	type AskAnswer,
	type CanvasCommandResult,
	CanvasRegionSchema,
	type CompareInput,
	CompareSchema,
	CompareShape,
	computeFrontier,
	diffAlternatives,
	type FrontierGraph,
	FrontierGraphSchema,
	FrontierGraphShape,
	KEEP_GRILLING_LABEL,
	type Question,
	QuestionSchema,
	QuestionShape,
	RenderDiagramSchema,
	RenderDiagramShape,
	RenderPrototypeSchema,
	RenderPrototypeShape,
} from '@tldraw-code/protocol'
import type { ZodError } from 'zod'
import { z } from 'zod'
import {
	type AskClock,
	AskCoordinator,
	type AskOutcome,
	type AskTimings,
	DEFAULT_ASK_TIMINGS,
} from './ask'
import { type CanvasBridge, CanvasBridgeError } from './bridge'
import { ToolInputError } from './errors'
import { describeRead, fetchActivityNote } from './perception'
import {
	defaultTrackerOptions,
	describeSync,
	resolveMapTarget,
	syncMap,
	type TrackerOptions,
} from './tracker'

export const SERVER_NAME = 'tldraw-canvas'
export const SERVER_VERSION = '0.0.0'

/**
 * Sent to the client on initialize; Claude Code puts it into Claude's context,
 * so the perception loop (ADR 0009) holds without any skill being loaded.
 */
export const SERVER_INSTRUCTIONS =
	'The user works with you on a shared tldraw canvas and answers there, not in the terminal. ' +
	'The canvas changes between your tool calls: the user adds sticky notes, drawings and arrows. ' +
	'Call read_canvas (shape data plus a screenshot) before each new question, before interpreting an ' +
	'answer that refers to the canvas (e.g. a sticky-note answer), and whenever a tool result reports ' +
	'canvas activity. Treat a sticky note or drawing next to or on a question card or decision node as ' +
	"the user's comment on it; one on a prototype is feedback on that prototype. " +
	'When the session works a wayfinder map on the issue tracker, its tickets are the source of truth: ' +
	'draw the map with sync_wayfinder_map instead of render_graph, and call it again after every change ' +
	'you make to the tickets.'

/**
 * Build the MCP server with all canvas tools registered. Transport-agnostic:
 * `main.ts` connects it to stdio, tests connect it to an in-memory transport.
 */
export interface McpServerOptions {
	/** Timeout and heartbeat of `ask` (ADR 0006). */
	ask?: Partial<AskTimings>
	/** Time source of `ask`'s timeout and heartbeat; real timers by default (tests pass a manual clock). */
	clock?: AskClock
	/** Diagnostic logger; must not write to stdout. */
	log?: (message: string) => void
	/** Where `sync_wayfinder_map` reads tickets (ADR 0012); GitHub Issues of the current repo by default. */
	tracker?: TrackerOptions
}

export function createMcpServer(bridge: CanvasBridge, options: McpServerOptions = {}): McpServer {
	const server = new McpServer(
		{ name: SERVER_NAME, version: SERVER_VERSION },
		{ instructions: SERVER_INSTRUCTIONS },
	)
	/** Tool result that ends with the canvas activity digest (ADR 0009). */
	const withActivity = (run: () => Promise<string>) =>
		toToolResult(async () => {
			const text = await run()
			const note = await fetchActivityNote(bridge)
			return note ? `${text}\n\n${note}` : text
		})
	const askTimings = { ...DEFAULT_ASK_TIMINGS, ...options.ask }
	const asks = new AskCoordinator(bridge, askTimings, options.log, options.clock)
	const tracker = options.tracker ?? defaultTrackerOptions()
	/** The map the last sync read, so a later sync can omit it. */
	let lastMap: Awaited<ReturnType<typeof resolveMapTarget>> | undefined

	/** Draw a validated graph; collapses the answered question card with it (ADR 0010). */
	const renderGraph = async (graph: FrontierGraph, frontier: string[]) => {
		const collapseQuestion = asks.answeredQuestion()
		const result = await bridge.request('graph.render', {
			...graph,
			frontier,
			...(collapseQuestion ? { collapseQuestion } : {}),
		})
		// Collapsed now, or already gone (replaced or deleted by the user): either way done.
		if (collapseQuestion) asks.forgetAnsweredQuestion(collapseQuestion)
		return result
	}

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
			withActivity(async () => {
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
				'decision nodes (stable id, short title, status open/in_progress/resolved/blocked, optional one-line ' +
				'note; in_progress = being worked on right now, not on the frontier) ' +
				'and dependency edges {from, to} meaning "from must be resolved before to". ' +
				'Layout, status colours and the frontier (open nodes whose blockers are all resolved, highlighted) ' +
				'are computed for you. Nodes and edges are matched by id: existing shapes are updated, ' +
				'new ones added, and ones missing from this call removed. If you have received the answer to ' +
				'the question card on the canvas, the card is removed: put the answer into the note of the ' +
				'decision node it settled.',
			inputSchema: FrontierGraphShape,
		},
		async (args) =>
			withActivity(async () => {
				const parsed = FrontierGraphSchema.safeParse(args)
				if (!parsed.success) throw new ToolInputError('invalid_graph', describeIssues(parsed.error))
				const graph = parsed.data
				const frontier = computeFrontier(graph)
				const result = await renderGraph(graph, frontier)
				return [
					describeRender(graph.nodes.length, graph.edges.length, result),
					`Frontier: ${frontier.length > 0 ? frontier.join(', ') : '(empty)'}.`,
				].join('\n')
			}),
	)

	server.registerTool(
		'sync_wayfinder_map',
		{
			title: 'Sync the wayfinder map to the canvas',
			description:
				'Draw a wayfinder map from the issue tracker (GitHub Issues) on the canvas: each child ticket of ' +
				'the map issue becomes a decision node, each blocking link a dependency edge, and the frontier ' +
				'(open, unblocked, unclaimed tickets) is highlighted. Status: closed ticket = resolved (note: its ' +
				"gist from the map's Decisions so far); open ticket with an assignee (claimed) = in_progress; open " +
				'ticket with an open blocker outside the map or a blocked/needs-info label = blocked (these win over ' +
				'the assignee); other open tickets = open; tickets closed as ' +
				'not planned or listed under Out of scope are left out. The tickets stay the source of truth: ' +
				'call this at the start of (or when resuming) a session on a map, and again after every change ' +
				'to its tickets, so the canvas shows the tracker. Replaces the graph drawn by render_graph.',
			inputSchema: {
				map: z
					.union([z.number().int().positive(), z.string().min(1).max(300)])
					.optional()
					.describe(
						'The map issue: number (12), "#12", "owner/name#12" or its GitHub URL. ' +
							'Defaults to the map of the last sync.',
					),
				repo: z
					.string()
					.min(3)
					.max(200)
					.optional()
					.describe(
						'Repository "owner/name" of the map; defaults to the origin remote of the repo the server runs in.',
					),
			},
		},
		async ({ map, repo }) =>
			withActivity(async () => {
				if (map === undefined && !lastMap) {
					throw new ToolInputError(
						'invalid_map',
						'No map synced yet in this session: pass the number or URL of the wayfinder map issue.',
					)
				}
				const target =
					map === undefined && lastMap ? lastMap : await resolveMapTarget(tracker, map ?? '', repo)
				const synced = await syncMap(tracker, target)
				lastMap = target
				const { graph, frontier } = synced.derived
				const result = await renderGraph(graph, frontier)
				return describeSync(synced, describeRender(graph.nodes.length, graph.edges.length, result))
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
			withActivity(async () => {
				const parsed = QuestionSchema.safeParse(args)
				if (!parsed.success) {
					throw new ToolInputError('invalid_question', describeIssues(parsed.error))
				}
				const outcome = await asks.ask(parsed.data, {
					signal: extra.signal,
					onHeartbeat: heartbeat(extra),
				})
				return describeAskOutcome(parsed.data, outcome, askTimings.timeoutMs, 'ask')
			}),
	)

	server.registerTool(
		'render_diagram',
		{
			title: 'Render a diagram',
			description:
				'Draw a diagram on the canvas as native shapes the user can move, mark and sketch on: nodes ' +
				'{id, label, look? box|ellipse|diamond} and directed edges {from, to, label?}, laid out left to ' +
				"right in the same style as the frontier graph, inside a frame titled with the diagram's title. " +
				'Pass the whole diagram every time; rendering again with the same id updates it in place. ' +
				'A new diagram is placed to the right of what is on the canvas. To put alternatives side by side ' +
				'and ask which one to take, use compare instead.',
			inputSchema: RenderDiagramShape,
		},
		async (args) =>
			withActivity(async () => {
				const parsed = RenderDiagramSchema.safeParse(args)
				if (!parsed.success)
					throw new ToolInputError('invalid_diagram', describeIssues(parsed.error))
				const { id, title, spec } = parsed.data
				const result = await bridge.request('diagram.render', {
					kind: 'diagram',
					id,
					frames: [
						{
							title: title ?? id,
							nodes: spec.nodes,
							edges: spec.edges,
							highlight: { nodes: [], edges: [] },
						},
					],
				})
				return (
					`Rendered diagram "${id}" in frame ${result.frameIds[0]}: ` +
					describeCounts(spec.nodes.length, spec.edges.length, result)
				)
			}),
	)

	server.registerTool(
		'compare',
		{
			title: 'Compare alternatives and ask',
			description:
				'Show 2 or 3 alternative diagrams side by side, each in its own frame, with what differs between ' +
				'them highlighted in orange, and ask the user which to take: a question card is attached below ' +
				'the frames (via ask), with one button per alternative, your recommendation marked, and "' +
				`${KEEP_GRILLING_LABEL}". Use it for questions about structure or flow, instead of describing ` +
				'alternatives in words. Each item is {label, caption?, spec} with spec like render_diagram. Give ' +
				'the same element the same node id in every alternative: nodes are matched by id and edges by ' +
				'their endpoints, and all frames share one layout, so common parts sit in the same place. ' +
				'Blocks like ask and returns the answer; after "no answer yet", call compare again with the same ' +
				'arguments to keep waiting (the frames and the card are kept). The frames stay on the canvas; ' +
				'the next render_graph removes the answered card.',
			inputSchema: CompareShape,
		},
		async (args, extra) =>
			withActivity(async () => {
				const parsed = CompareSchema.safeParse(args)
				if (!parsed.success) {
					throw new ToolInputError('invalid_comparison', describeIssues(parsed.error))
				}
				if (asks.isWaiting()) {
					throw new ToolInputError(
						'ask_in_progress',
						'Another ask or compare call is still waiting for the user. Ask one question at a time.',
					)
				}
				const input = parsed.data
				const differences = diffAlternatives(input.items.map((item) => item.spec))
				const rendered = await bridge.request('diagram.render', {
					kind: 'comparison',
					id: input.id,
					frames: input.items.map((item, index) => ({
						title: item.label,
						...(item.caption ? { caption: item.caption } : {}),
						nodes: item.spec.nodes,
						edges: item.spec.edges,
						highlight: {
							nodes: differences[index]?.nodes.map((d) => d.id) ?? [],
							edges: differences[index]?.edges.map((d) => d.id) ?? [],
						},
					})),
				})
				const question: Question = {
					question: input.question,
					options: input.items.map((item) => item.label),
					recommendation: input.recommendation,
				}
				const outcome = await asks.ask(question, {
					signal: extra.signal,
					onHeartbeat: heartbeat(extra),
					comparison: input.id,
				})
				return [
					describeComparison(input, differences, rendered.frameIds),
					'',
					describeAskOutcome(question, outcome, askTimings.timeoutMs, 'compare'),
				].join('\n')
			}),
	)

	server.registerTool(
		'render_prototype',
		{
			title: 'Render an HTML prototype',
			description:
				'Show a clickable UI prototype on the canvas: one self-contained HTML document (all CSS and JS ' +
				'inline) in a prototype frame titled with its label. It runs in a sandboxed iframe with no network, ' +
				'storage, cookies, pop-ups or dialogs, so external URLs do not load: inline what it needs, and copy ' +
				"the repo's own styles (CSS variables, component classes, fonts as data: URLs) into it so it looks " +
				'like the real app. The user can click through it and scribble or stick notes on it; read_canvas ' +
				'then anchors each annotation to this prototype with its position inside it, and its screenshot ' +
				'shows the prototype as currently displayed. To act on such feedback, render a new iteration with ' +
				'iterationOf set to this id and a new label: it appears right next to the old one, which stays. ' +
				'Rendering again with the same id (default: a slug of the label) replaces its HTML in place. For a ' +
				'UI choice, render 2 or 3 prototypes, then ask which to take.',
			inputSchema: RenderPrototypeShape,
		},
		async (args) =>
			withActivity(async () => {
				const parsed = RenderPrototypeSchema.safeParse(args)
				if (!parsed.success) {
					throw new ToolInputError('invalid_prototype', describeIssues(parsed.error))
				}
				const input = parsed.data
				const result = await bridge.request('prototype.render', {
					id: input.id,
					label: input.label,
					html: input.html,
					...(input.caption ? { caption: input.caption } : {}),
					...(input.iterationOf ? { iterationOf: input.iterationOf } : {}),
					...(input.width ? { width: input.width } : {}),
					...(input.height ? { height: input.height } : {}),
				})
				const { x, y, w, h } = result.bounds
				return [
					`${result.created ? 'Rendered' : 'Updated'} prototype "${input.id}" ("${input.label}") in shape ` +
						`${result.shapeId} at x ${x}, y ${y}, ${w} x ${h} (viewport ${result.width} x ${result.height} px).`,
					...(input.iterationOf && result.created
						? [`It is a new iteration of "${input.iterationOf}", placed right next to it.`]
						: []),
					'The user can click through it. Sketches and sticky notes on it show up in read_canvas anchored ' +
						'to it, with their position in prototype px.',
				].join('\n')
			}),
	)

	server.registerTool(
		'read_canvas',
		{
			title: 'Read the canvas',
			description:
				'See what is on the canvas: shape data (role, owner, text, colour, bounds, and for the ' +
				"user's shapes the decision node, question card, diagram or prototype they are on or next to, " +
				'for a prototype with their position inside it in prototype px) plus a PNG screenshot ' +
				'of the region. Shape data alone does not carry the meaning of a sketch; look at the screenshot. ' +
				'Region: "all" (default, whole page), "viewport" (what the user sees), "question" (the question ' +
				'card and its surroundings, where sticky-note answers and sketches next to it are), or a page box ' +
				'{x, y, w, h} to zoom in (e.g. around a shape from an earlier read; screenshots are at most ' +
				'1568 px wide, so read a smaller region to make out details). Resets the canvas activity digest.',
			inputSchema: {
				region: CanvasRegionSchema.optional().describe(
					'"all" | "viewport" | "question" | {x, y, w, h} in page units. Defaults to "all".',
				),
				screenshot: z
					.boolean()
					.optional()
					.describe('Attach a screenshot of the region (default true).'),
			},
		},
		async ({ region = 'all', screenshot = true }) => {
			try {
				const result = await bridge.request('canvas.read', { region, screenshot })
				const content: CallToolResult['content'] = [
					{ type: 'text', text: describeRead(region, result) },
				]
				if (result.screenshot) {
					content.push({
						type: 'image',
						data: result.screenshot.data,
						mimeType: result.screenshot.mimeType,
					})
				}
				return { content }
			} catch (error) {
				return toolError(error)
			}
		},
	)

	return server
}

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>

/** Progress heartbeat for a blocking call, if the client asked for progress (ADR 0006). */
function heartbeat(extra: ToolExtra): ((waitedMs: number) => void) | undefined {
	const progressToken = extra._meta?.progressToken
	if (progressToken === undefined) return undefined
	return (waitedMs) =>
		void extra
			.sendNotification({
				method: 'notifications/progress',
				params: {
					progressToken,
					progress: Math.round(waitedMs / 1000),
					message: 'Waiting for the answer on the canvas',
				},
			})
			.catch(() => {})
}

function describeAskOutcome(
	question: Question,
	outcome: AskOutcome,
	timeoutMs: number,
	tool: 'ask' | 'compare',
): string {
	switch (outcome.kind) {
		case 'answered':
			return describeAnswer(question, outcome.answer)
		case 'timeout':
			return (
				`No answer yet: the user has not answered within ${formatDuration(timeoutMs)}. ` +
				`The question card stays open on the canvas. To keep waiting, call ${tool} again with exactly ` +
				'the same arguments; an answer given in the meantime is returned at once.'
			)
		case 'cancelled':
			return `The ${tool} call was cancelled. The question card stays open on the canvas.`
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

/** What `compare` drew, with the differences it highlighted per alternative. */
function describeComparison(
	input: CompareInput,
	differences: AlternativeDifferences[],
	frameIds: string[],
): string {
	const lines = [
		`Showing ${input.items.length} alternatives side by side for "${input.id}" (frames ${frameIds.join(', ')}); ` +
			'a question card below them asks which to take.',
	]
	const any = differences.some((d) => d.nodes.length + d.edges.length > 0)
	if (!any) {
		lines.push('The alternatives have the same nodes and edges: nothing is highlighted.')
		return lines.join('\n')
	}
	lines.push('Highlighted in orange as differences:')
	input.items.forEach((item, index) => {
		const diff = differences[index] ?? { nodes: [], edges: [] }
		const list = (elements: typeof diff.nodes) =>
			elements.map((e) => `${e.id}${e.kind === 'changed' ? ' (changed)' : ''}`).join(', ')
		const parts = [
			...(diff.nodes.length > 0 ? [`nodes ${list(diff.nodes)}`] : []),
			...(diff.edges.length > 0 ? [`edges ${list(diff.edges)}`] : []),
		]
		lines.push(`- ${item.label}: ${parts.length > 0 ? parts.join('; ') : 'nothing of its own'}`)
	})
	return lines.join('\n')
}

function describeCounts(
	nodeCount: number,
	edgeCount: number,
	{ nodes, edges }: Pick<CanvasCommandResult<'diagram.render'>, 'nodes' | 'edges'>,
): string {
	const counts = (c: typeof nodes) => `${c.created} new, ${c.updated} updated, ${c.removed} removed`
	return `${nodeCount} nodes (${counts(nodes)}) and ${edgeCount} edges (${counts(edges)}).`
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
	{ nodes, edges, questionCollapsed }: CanvasCommandResult<'graph.render'>,
): string {
	const counts = (c: typeof nodes) => `${c.created} new, ${c.updated} updated, ${c.removed} removed`
	return [
		`Rendered ${nodeCount} decision nodes (${counts(nodes)}) and ${edgeCount} edges (${counts(edges)}).`,
		...(questionCollapsed ? ['Removed the answered question card; the graph now shows it.'] : []),
	].join('\n')
}

async function toToolResult(run: () => Promise<string>): Promise<CallToolResult> {
	try {
		return { content: [{ type: 'text', text: await run() }] }
	} catch (error) {
		return toolError(error)
	}
}

/** Report a bridge or input error to Claude as a tool error `[code] message`; rethrow anything else. */
function toolError(error: unknown): CallToolResult {
	if (error instanceof CanvasBridgeError || error instanceof ToolInputError) {
		return {
			isError: true,
			content: [{ type: 'text', text: `[${error.code}] ${error.message}` }],
		}
	}
	throw error
}
