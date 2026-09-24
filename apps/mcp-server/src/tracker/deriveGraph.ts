import {
	computeFrontier,
	type DecisionNode,
	type DecisionStatus,
	type DependencyEdge,
	type FrontierGraph,
	FrontierGraphSchema,
	MAX_GRAPH_EDGES,
	MAX_GRAPH_NODES,
} from '@tldraw-code/protocol'
import { ToolInputError } from '../errors'
import type { Ticket, WayfinderMap } from './loadMap'
import { decisionGists, outOfScopeRefs } from './markdown'

/**
 * Deriving the frontier graph from a wayfinder map's tickets (ADR 0012). Pure:
 * the tickets are the source of truth, the graph is a view of them.
 *
 * Ticket to node status:
 * - closed as not planned or duplicate, labelled `wontfix`, or linked from the
 *   map's Out of scope section: left out of the graph (off the route);
 * - otherwise closed: `resolved`, noted with its gist from Decisions so far;
 * - open with an open blocker outside the map: `blocked` ("Waiting on ...");
 * - open and labelled `blocked` or `needs-info`: `blocked`;
 * - open and assigned (claimed by a session): `blocked` ("Claimed by @...");
 * - otherwise open: `open`.
 * A blocker that is a ticket of the map becomes a dependency edge; the
 * frontier is then the open nodes whose blockers are all resolved, which is
 * the tracker's own frontier: open, unblocked, unclaimed tickets.
 */

export const BLOCKED_LABELS = ['blocked', 'needs-info']
export const OUT_OF_SCOPE_LABELS = ['wontfix']
const OUT_OF_SCOPE_REASONS = ['not_planned', 'duplicate']

export interface TicketNode {
	ticket: Ticket
	node: DecisionNode
	/** Why the node has its status, in a few words (e.g. "closed", "claimed by @ana"). */
	reason: string
}

export interface MapGraph {
	graph: FrontierGraph
	frontier: string[]
	/** One entry per node, in map order. */
	nodes: TicketNode[]
	/** Tickets of the map that are not on the graph, and why. */
	leftOut: { ticket: Ticket; reason: string }[]
	warnings: string[]
}

const MAX_TITLE = 120
const MAX_NOTE = 200

export function deriveMapGraph(map: WayfinderMap): MapGraph {
	const gists = decisionGists(map.body, map.repo)
	const ruledOut = new Set(outOfScopeRefs(map.body, map.repo).map(String))
	const warnings = [...map.warnings]

	const leftOut: MapGraph['leftOut'] = []
	const onGraph: Ticket[] = []
	for (const ticket of map.tickets) {
		const reason = outOfScopeReason(ticket, ruledOut)
		if (reason) leftOut.push({ ticket, reason })
		else onGraph.push(ticket)
	}
	const onGraphKeys = new Set(onGraph.map((t) => t.key))
	const childKeys = new Set(map.tickets.map((t) => t.key))

	const nodes: TicketNode[] = onGraph.map((ticket) => {
		const { status, note, reason } = statusOf(ticket, map, childKeys, gists)
		const node: DecisionNode = {
			id: nodeId(ticket.key),
			title: truncate(ticket.title, MAX_TITLE),
			status,
			...(note ? { note: truncate(note, MAX_NOTE) } : {}),
		}
		return { ticket, node, reason }
	})

	const edges: DependencyEdge[] = []
	for (const ticket of onGraph) {
		for (const blocker of ticket.blockedBy) {
			// A blocker ruled out of scope is closed or off the route: it no longer gates.
			if (onGraphKeys.has(blocker)) edges.push({ from: nodeId(blocker), to: nodeId(ticket.key) })
		}
	}

	if (nodes.length === 0) {
		throw new ToolInputError(
			'empty_map',
			`The map "${map.title}" has no tickets on the route yet${leftOut.length ? ` (${leftOut.length} ruled out of scope)` : ''}. ` +
				'Create its child tickets first (sub-issues, or a task list in the map body).',
		)
	}
	if (nodes.length > MAX_GRAPH_NODES || edges.length > MAX_GRAPH_EDGES) {
		throw new ToolInputError(
			'map_too_large',
			`The map "${map.title}" has ${nodes.length} tickets and ${edges.length} blocking edges; ` +
				`the canvas shows at most ${MAX_GRAPH_NODES} and ${MAX_GRAPH_EDGES}.`,
		)
	}
	const graph = FrontierGraphSchema.parse({ nodes: nodes.map((n) => n.node), edges })
	return { graph, frontier: computeFrontier(graph), nodes, leftOut, warnings }
}

function outOfScopeReason(ticket: Ticket, ruledOut: Set<string>): string | undefined {
	if (ruledOut.has(ticket.key)) return 'listed under Out of scope on the map'
	if (ticket.state !== 'closed') return undefined
	if (ticket.stateReason && OUT_OF_SCOPE_REASONS.includes(ticket.stateReason)) {
		return `closed as ${ticket.stateReason.replace('_', ' ')}`
	}
	const label = ticket.labels.find((l) => OUT_OF_SCOPE_LABELS.includes(l.toLowerCase()))
	return label ? `closed with label ${label}` : undefined
}

function statusOf(
	ticket: Ticket,
	map: WayfinderMap,
	childKeys: Set<string>,
	gists: Map<number, string>,
): { status: DecisionStatus; note?: string; reason: string } {
	if (ticket.state === 'closed') {
		const gist = ticket.key === String(ticket.number) ? gists.get(ticket.number) : undefined
		return { status: 'resolved', ...(gist ? { note: gist } : {}), reason: 'closed' }
	}
	const openOutside = ticket.blockedBy
		.filter((key) => !childKeys.has(key))
		.map((key) => map.outside.get(key))
		.filter((t): t is Ticket => t?.state === 'open')
	if (openOutside.length > 0) {
		const names = openOutside.map((t) => `"${t.title}"`).join(', ')
		return {
			status: 'blocked',
			note: `Waiting on ${names}`,
			reason: `blocked by open ${openOutside.map(refOf).join(', ')} outside the map`,
		}
	}
	const label = ticket.labels.find((l) => BLOCKED_LABELS.includes(l.toLowerCase()))
	if (label) return { status: 'blocked', note: `Labelled ${label}`, reason: `label ${label}` }
	if (ticket.assignees.length > 0) {
		const who = ticket.assignees.map((a) => `@${a}`).join(', ')
		return { status: 'blocked', note: `Claimed by ${who}`, reason: `claimed by ${who}` }
	}
	return { status: 'open', reason: 'open, unclaimed' }
}

/** `#12`, or `owner/name#12` for an issue of another repository. */
export function refOf(ticket: Pick<Ticket, 'key'>): string {
	return ticket.key.includes('#') ? ticket.key : `#${ticket.key}`
}

/** Decision node id of a ticket: its number, or `owner:name:12` across repositories. */
export function nodeId(key: string): string {
	return key.replace(/[^A-Za-z0-9_.:-]/g, ':').slice(0, 64)
}

function truncate(text: string, max: number): string {
	const oneLine = text.replace(/\s+/g, ' ').trim()
	return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`
}
