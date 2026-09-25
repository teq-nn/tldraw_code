import {
	type CanvasCommandName,
	type CanvasCommandPayload,
	type CanvasCommandResult,
	computeFrontier,
	type DecisionNode,
	type DependencyEdge,
	type DiagramSpec,
	diffAlternatives,
} from '@tldraw-code/protocol'
import {
	Box,
	createShapeId,
	type Editor,
	type TLArrowBinding,
	type TLArrowShape,
	type TLNoteShape,
	type TLShapeId,
	toRichText,
} from 'tldraw'
import { answerQuestionCard, type QuestionCardShape } from '../src/ask/QuestionCardShapeUtil'
import { questionCardId } from '../src/ask/showQuestion'
import { getComparisonFrames } from '../src/comparison/comparisonFrames'
import { nodeShapeId } from '../src/graph/renderGraph'
import { agentNoteShapeId } from '../src/note/renderNote'
import { ANCHOR_REACH } from '../src/perception/readCanvas'
import { prototypeShapeId } from '../src/prototype/renderPrototype'
import { boxGap } from './metrics'

/**
 * The layout benchmark's scene (issue #25, docs/research/canvas-layout.md
 * §12): one representative session, replayed identically for every layout
 * flavour. Claude acts through the canvas commands, exactly as the MCP server
 * sends them; the user acts directly on the editor, as their tools would.
 * Where the user puts something depends on where the flavour put Claude's
 * shapes ("a note on `schema`"), so every flavour gets the same intent.
 */

export interface SceneContext {
	editor: Editor
	/** Run one canvas command as Claude, through the flavour's handlers. */
	claude<N extends CanvasCommandName>(
		command: N,
		payload: CanvasCommandPayload<N>,
	): Promise<CanvasCommandResult<N>>
}

export interface SceneStep {
	/** Short name for the scorecard's column. */
	name: string
	run(context: SceneContext): Promise<void>
	/**
	 * The content this step put on the canvas for the user to look at, and
	 * the shapes it is about; scored as the distance between the two.
	 */
	focus?(editor: Editor): { content: TLShapeId[]; subject: TLShapeId[] }
}

export interface Scene {
	steps: SceneStep[]
	/** The user's annotations whose anchors (ADR 0008) should survive, from step `anchorsFrom` on. */
	annotations: { ids: TLShapeId[]; anchorsFrom: number }
	/** Pairs of step numbers (1-based) between which the graph's stability is scored. */
	stabilitySpans: [number, number][]
}

// --- The frontier graph ---------------------------------------------------------------------

const node = (
	id: string,
	title: string,
	status: DecisionNode['status'] = 'open',
	note?: string,
): DecisionNode => ({ id, title, status, ...(note ? { note } : {}) })

const edges = (...pairs: string[]): DependencyEdge[] =>
	pairs.map((pair) => {
		const [from = '', to = ''] = pair.split('->')
		return { from, to }
	})

/** 12 decisions, 14 dependencies: two roots, a diamond, a chain of 5; 3 resolved. */
const firstGraph = {
	nodes: [
		node('scope', 'Scope of v1', 'resolved', 'Sync settings only'),
		node('hosting', 'Hosting', 'resolved', 'Managed Postgres'),
		node('schema', 'Settings schema', 'resolved', 'One JSON document per user'),
		node('auth', 'Sign-in'),
		node('storage', 'Storage engine'),
		node('deploy', 'Deploy pipeline'),
		node('api', 'Write API'),
		node('client', 'Client library'),
		node('release', 'Release plan'),
		node('sync', 'Sync status UI'),
		node('offline', 'Offline edits'),
		node('billing', 'Billing'),
	],
	edges: edges(
		// The chain of 5.
		'scope->schema',
		'schema->api',
		'api->client',
		'client->release',
		// The diamond under the second root.
		'hosting->auth',
		'hosting->storage',
		'auth->deploy',
		'storage->deploy',
		// The rest.
		'schema->sync',
		'sync->offline',
		'offline->client',
		'auth->api',
		'deploy->release',
		'api->billing',
	),
}

/** Sign-in resolved; a migration inserted upstream of the API (every rank after it shifts); billing dropped. */
const secondGraph = {
	nodes: [
		...firstGraph.nodes
			.filter((n) => n.id !== 'billing')
			.map((n) =>
				n.id === 'auth' ? node('auth', 'Sign-in', 'resolved', 'OAuth, passwords for admins') : n,
			),
		node('migration', 'Data migration'),
		node('audit', 'Audit log'),
		node('export', 'Data export'),
	],
	edges: [
		...firstGraph.edges.filter((e) => e.to !== 'billing'),
		...edges('schema->migration', 'migration->api', 'auth->audit', 'api->export'),
	],
}

/** Both comparisons settled into the graph, and two more decisions downstream. */
const thirdGraph = {
	nodes: [
		...secondGraph.nodes.map((n) => {
			if (n.id === 'api')
				return node('api', 'Write API', 'resolved', 'Queue in front of the worker')
			if (n.id === 'sync') return node('sync', 'Sync status UI', 'resolved', 'A banner')
			return n
		}),
		node('docs', 'Public docs'),
		node('support', 'Support runbook'),
	],
	edges: [...secondGraph.edges, ...edges('release->docs', 'client->support')],
}

/**
 * The release plan broken down while its question card is still open (the
 * user has not answered yet, so the card stays, ADR 0010): six decisions
 * join the rank after the release plan, and the graph grows downward (#26).
 */
const fourthGraph = {
	nodes: [
		...thirdGraph.nodes,
		node('beta', 'Beta group'),
		node('rollout', 'Staged rollout'),
		node('rollback', 'Rollback plan'),
		node('announce', 'Announcement'),
		node('changelog', 'Changelog'),
		node('training', 'Support training'),
	],
	edges: [
		...thirdGraph.edges,
		...edges(
			'release->beta',
			'release->rollout',
			'release->rollback',
			'release->announce',
			'release->changelog',
			'release->training',
		),
	],
}

const renderGraph = (
	{ claude }: SceneContext,
	graph: typeof firstGraph,
	collapseQuestion?: string,
) =>
	claude('graph.render', {
		...graph,
		frontier: computeFrontier(graph),
		...(collapseQuestion ? { collapseQuestion } : {}),
	})

// --- The comparisons ------------------------------------------------------------------------

const flow = (...pairs: string[]): DiagramSpec => {
	const links = edges(...pairs)
	const ids = [...new Set(links.flatMap((e) => [e.from, e.to]))]
	return {
		nodes: ids.map((id) => ({ id, label: id[0]?.toUpperCase() + id.slice(1) })),
		edges: links,
	}
}

const API_FLOW = 'api-flow'
/** Three write paths; "Worker first" orders worker and queue the other way round (the #23 case). */
const apiFlows = [
	{
		label: 'Direct',
		caption: 'The API writes through the worker',
		spec: flow('client->gateway', 'gateway->api', 'api->worker', 'worker->db', 'api->cache'),
	},
	{
		label: 'Queued',
		caption: 'A queue absorbs bursts',
		spec: flow(
			'client->gateway',
			'gateway->api',
			'api->queue',
			'queue->worker',
			'worker->db',
			'api->cache',
		),
	},
	{
		label: 'Worker first',
		caption: 'The worker batches into a queue',
		spec: flow(
			'client->gateway',
			'gateway->api',
			'api->worker',
			'worker->queue',
			'queue->db',
			'api->cache',
		),
	},
]

const SYNC_UI = 'sync-ui'
const PHONE = { width: 390, height: 844 }
const syncScreens = [
	{ label: 'Banner', caption: 'Status in a banner on every screen' },
	{ label: 'Tab', caption: 'Status in its own tab' },
]
const screenHtml = (label: string) =>
	`<!doctype html><html><body style="font-family:sans-serif;margin:0">` +
	`<header style="padding:16px;background:#dbeafe">Settings</header>` +
	`<main style="padding:16px">${label}: last synced 2 minutes ago</main></body></html>`

// --- The user's shapes ----------------------------------------------------------------------

/** The user's annotations, by fixed ids so every step can find them again. */
export const USER_SHAPES = {
	noteOnSchema: createShapeId('user-note-on-schema'),
	noteBetween: createShapeId('user-note-between-api-and-auth'),
	noteFloating: createShapeId('user-note-floating'),
	arrow: createShapeId('user-arrow-to-release'),
	answer: createShapeId('user-note-answer'),
	onPrototype: createShapeId('user-note-on-prototype'),
} as const

const NOTE_SIZE = 200

function stickNote(editor: Editor, id: TLShapeId, text: string, x: number, y: number): void {
	editor.createShape<TLNoteShape>({ id, type: 'note', x, y, props: { richText: toRichText(text) } })
}

function bounds(editor: Editor, id: TLShapeId) {
	const box = editor.getShapePageBounds(id)
	if (!box) throw new Error(`The scene expects shape ${id} on the canvas.`)
	return box
}

/**
 * Where the user sticks a note that is about several shapes: the free spot
 * nearest the middle between them that is within anchor reach (ADR 0008) of
 * every one, so which one it annotates is up to the canvas's rule.
 */
function freeSpotNear(editor: Editor, targets: TLShapeId[]): { x: number; y: number } {
	const boxes = targets.map((id) => bounds(editor, id))
	const middle = {
		x: boxes.reduce((sum, box) => sum + box.center.x, 0) / boxes.length,
		y: boxes.reduce((sum, box) => sum + box.center.y, 0) / boxes.length,
	}
	const taken = editor
		.getCurrentPageShapes()
		.filter((shape) => shape.parentId === editor.getCurrentPageId() && shape.type !== 'arrow')
		.flatMap((shape) => editor.getShapePageBounds(shape.id) ?? [])
	const STEP = 20
	for (let ring = 0; ring <= 30; ring++) {
		for (const [dx, dy] of ringOffsets(ring)) {
			const note = new Box(
				middle.x + dx * STEP - NOTE_SIZE / 2,
				middle.y + dy * STEP - NOTE_SIZE / 2,
				NOTE_SIZE,
				NOTE_SIZE,
			)
			const free = taken.every((box) => !Box.Collides(note, box))
			const inReach = boxes.every((box) => boxGap(note, box) <= ANCHOR_REACH)
			if (free && inReach) return { x: note.x, y: note.y }
		}
	}
	throw new Error('The scene found no free spot for a note near all of its shapes.')
}

/** The grid offsets on the square ring `ring` steps out from the centre, in a fixed order. */
function ringOffsets(ring: number): [number, number][] {
	if (ring === 0) return [[0, 0]]
	const offsets: [number, number][] = []
	for (let i = -ring; i <= ring; i++) offsets.push([i, -ring], [i, ring])
	for (let i = -ring + 1; i < ring; i++) offsets.push([-ring, i], [ring, i])
	return offsets
}

function drag(editor: Editor, id: TLShapeId, dx: number, dy: number): void {
	const shape = editor.getShape(id)
	if (!shape) throw new Error(`The scene expects shape ${id} on the canvas.`)
	editor.updateShape({ id, type: shape.type, x: shape.x + dx, y: shape.y + dy })
}

function drawArrow(editor: Editor, id: TLShapeId, from: TLShapeId, to: TLShapeId): void {
	const start = bounds(editor, from).center
	editor.createShape<TLArrowShape>({ id, type: 'arrow', x: start.x, y: start.y })
	const binding = (target: TLShapeId, terminal: 'start' | 'end') => ({
		type: 'arrow' as const,
		fromId: id,
		toId: target,
		props: {
			terminal,
			normalizedAnchor: { x: 0.5, y: 0.5 },
			isExact: false,
			isPrecise: false,
			snap: 'none' as const,
		},
	})
	editor.createBindings<TLArrowBinding>([binding(from, 'start'), binding(to, 'end')])
}

function clickOption(editor: Editor, askId: string, option: number): void {
	const card = editor.getShape<QuestionCardShape>(questionCardId(askId))
	if (!card) throw new Error(`The scene expects the question card "${askId}" on the canvas.`)
	answerQuestionCard(editor, card, { answerKind: 'option', answerOption: option })
}

const comparisonFrameIds = (editor: Editor, id: string) =>
	getComparisonFrames(editor, id).map((frame) => frame.shape.id)

// --- The steps ------------------------------------------------------------------------------

const AUTH_ASK = 'ask-auth'
const API_ASK = 'ask-api-flow'
const SYNC_ASK = 'ask-sync-ui'
const REPLY_NOTE = 'reply-to-floating-note'
const RELEASE_ASK = 'ask-release'

export const SCENE: Scene = {
	annotations: {
		ids: [
			USER_SHAPES.noteOnSchema,
			USER_SHAPES.noteBetween,
			USER_SHAPES.noteFloating,
			USER_SHAPES.arrow,
		],
		anchorsFrom: 2,
	},
	stabilitySpans: [
		[1, 4],
		[4, 7],
	],
	steps: [
		{
			name: 'graph',
			async run(context) {
				await renderGraph(context, firstGraph)
			},
		},
		{
			name: 'user',
			async run({ editor }) {
				// Both drags go to free space, so the user's own moves overlap nothing.
				drag(editor, nodeShapeId('storage'), 0, -150)
				drag(editor, nodeShapeId('billing'), 40, 150)
				const schema = bounds(editor, nodeShapeId('schema'))
				stickNote(editor, USER_SHAPES.noteOnSchema, 'Versioned?', schema.maxX - 80, schema.y + 30)
				const between = freeSpotNear(editor, [nodeShapeId('api'), nodeShapeId('auth')])
				stickNote(editor, USER_SHAPES.noteBetween, 'Rate limits here?', between.x, between.y)
				const page = editor.getCurrentPageBounds()
				stickNote(
					editor,
					USER_SHAPES.noteFloating,
					'Ask legal about retention',
					(page?.minX ?? 0) - 900,
					(page?.minY ?? 0) - 600,
				)
				drawArrow(editor, USER_SHAPES.arrow, USER_SHAPES.noteFloating, nodeShapeId('release'))
			},
		},
		{
			name: 'ask',
			async run(context) {
				await context.claude('ask.show', {
					askId: AUTH_ASK,
					question: 'How do users sign in?',
					options: ['OAuth', 'Passwords', 'Magic links'],
					recommendation: 0,
				})
				// The user answers with a sticky note beside the card.
				const card = bounds(context.editor, questionCardId(AUTH_ASK))
				stickNote(
					context.editor,
					USER_SHAPES.answer,
					'OAuth, passwords for admins',
					card.maxX + 40,
					card.y,
				)
			},
			focus: () => ({ content: [questionCardId(AUTH_ASK)], subject: [nodeShapeId('auth')] }),
		},
		{
			name: 'update',
			async run(context) {
				await renderGraph(context, secondGraph, AUTH_ASK)
			},
		},
		{
			name: 'diagrams',
			async run(context) {
				const specs = apiFlows.map((item) => item.spec)
				const differences = diffAlternatives(specs)
				await context.claude('diagram.render', {
					kind: 'comparison',
					id: API_FLOW,
					frames: apiFlows.map((item, index) => ({
						title: item.label,
						caption: item.caption,
						nodes: item.spec.nodes,
						edges: item.spec.edges,
						highlight: {
							nodes: differences[index]?.nodes.map((d) => d.id) ?? [],
							edges: differences[index]?.edges.map((d) => d.id) ?? [],
						},
					})),
				})
				await context.claude('ask.show', {
					askId: API_ASK,
					question: 'How should writes reach the database?',
					options: apiFlows.map((item) => item.label),
					recommendation: 1,
					comparison: API_FLOW,
				})
				clickOption(context.editor, API_ASK, 1)
			},
			focus: (editor) => ({
				content: [questionCardId(API_ASK)],
				subject: comparisonFrameIds(editor, API_FLOW),
			}),
		},
		{
			name: 'prototypes',
			async run(context) {
				for (const [index, screen] of syncScreens.entries()) {
					await context.claude('prototype.render', {
						id: `${SYNC_UI}-${screen.label.toLowerCase()}`,
						label: screen.label,
						caption: screen.caption,
						html: screenHtml(screen.label),
						...PHONE,
						comparison: { id: SYNC_UI, index, count: syncScreens.length },
					})
				}
				await context.claude('ask.show', {
					askId: SYNC_ASK,
					question: 'Where should the sync status show?',
					options: syncScreens.map((screen) => screen.label),
					recommendation: 0,
					comparison: SYNC_UI,
				})
				// The user sticks a note on the first screen, then picks it.
				const banner = bounds(context.editor, prototypeShapeId(`${SYNC_UI}-banner`))
				stickNote(
					context.editor,
					USER_SHAPES.onPrototype,
					'Too loud on every screen?',
					banner.x + 100,
					banner.y + 300,
				)
				clickOption(context.editor, SYNC_ASK, 0)
			},
			focus: (editor) => ({
				content: [questionCardId(SYNC_ASK)],
				subject: comparisonFrameIds(editor, SYNC_UI),
			}),
		},
		{
			name: 'settle',
			async run(context) {
				await context.claude('comparison.settle', {
					id: API_FLOW,
					chosen: 'Queued',
					rejected: [
						{ label: 'Direct', reason: 'Bursts would hit the database' },
						{ label: 'Worker first', reason: 'Batching delays every write' },
					],
					node: 'api',
				})
				await context.claude('comparison.settle', {
					id: SYNC_UI,
					chosen: 'Banner',
					rejected: [{ label: 'Tab', reason: 'Nobody opens a status tab' }],
					node: 'sync',
				})
				await context.claude('note.render', {
					id: REPLY_NOTE,
					text: 'Retention is part of the migration decision.',
					replyTo: USER_SHAPES.noteFloating,
				})
				await renderGraph(context, thirdGraph, SYNC_ASK)
			},
			focus: () => ({
				content: [agentNoteShapeId(REPLY_NOTE)],
				subject: [USER_SHAPES.noteFloating],
			}),
		},
		{
			name: 'grow',
			async run(context) {
				await context.claude('ask.show', {
					askId: RELEASE_ASK,
					question: 'How do we release v1?',
					options: ['All at once', 'Staged'],
					recommendation: 1,
				})
				// No answer yet: the card stays open while the graph grows under it.
				await renderGraph(context, fourthGraph)
			},
			focus: () => ({ content: [questionCardId(RELEASE_ASK)], subject: [nodeShapeId('release')] }),
		},
	],
}
