import { ToolInputError } from '../errors'
import { deriveMapGraph, type MapGraph, refOf } from './deriveGraph'
import { fixtureFileApi, readFixture } from './fixture'
import {
	createGitHubApi,
	detectRepo,
	formatRepo,
	type GitHubApi,
	parseRepo,
	type RepoRef,
	resolveGitHubToken,
} from './github'
import { loadWayfinderMap, parseMapRef, type WayfinderMap } from './loadMap'

export { deriveMapGraph, type MapGraph, nodeId } from './deriveGraph'
export {
	FixtureGitHub,
	type FixtureIssue,
	fixtureFileApi,
	readFixture,
	type TrackerFixture,
} from './fixture'
export { createGitHubApi, type GitHubApi, parseRepo, type RepoRef } from './github'
export { type GitHubIssue, loadWayfinderMap, parseMapRef, type Ticket } from './loadMap'

export const MAP_LABEL = 'wayfinder:map'

/** Where `sync_wayfinder_map` reads tickets from. Tests pass fixtures; see {@link defaultTrackerOptions}. */
export interface TrackerOptions {
	/** The GitHub API, created on first use. */
	api: () => Promise<GitHubApi>
	/** The repository used when the map argument names none. */
	repo: () => Promise<RepoRef | undefined>
}

/**
 * GitHub Issues of the repo the server runs in, read with the user's `gh`
 * login or token; or, with `CANVAS_TRACKER_FIXTURE` set, the fixture file it
 * names (ADR 0023).
 */
export function defaultTrackerOptions(env: NodeJS.ProcessEnv = process.env): TrackerOptions {
	const fixture = env.CANVAS_TRACKER_FIXTURE?.trim()
	if (fixture) {
		const api = fixtureFileApi(fixture)
		return {
			api: async () => api,
			// The fixture's own repository, unless CANVAS_TRACKER_REPO names another.
			repo: async () =>
				env.CANVAS_TRACKER_REPO ? detectRepo(env) : parseRepo((await readFixture(fixture)).repo),
		}
	}
	let api: Promise<GitHubApi> | undefined
	return {
		api: () => {
			api ??= resolveGitHubToken(env).then((token) =>
				createGitHubApi({ token, baseUrl: env.GITHUB_API_URL }),
			)
			return api
		},
		repo: () => detectRepo(env),
	}
}

export interface SyncedMap {
	map: WayfinderMap
	derived: MapGraph
}

/** The map a sync call names, as `{ repo, number }`. */
export async function resolveMapTarget(
	tracker: TrackerOptions,
	map: number | string,
	repo: string | undefined,
): Promise<{ repo: RepoRef; number: number }> {
	const ref = parseMapRef(map)
	if (!ref) {
		throw new ToolInputError(
			'invalid_map',
			`"${map}" is not an issue number, #number or GitHub issue URL.`,
		)
	}
	const explicitRepo = repo === undefined ? undefined : parseRepo(repo)
	if (repo !== undefined && !explicitRepo) {
		throw new ToolInputError('invalid_map', `"${repo}" is not a repository in the form owner/name.`)
	}
	const resolved = ref.repo ?? explicitRepo ?? (await tracker.repo())
	if (!resolved) {
		throw new ToolInputError(
			'invalid_map',
			'Could not tell which repository holds the map: pass repo "owner/name" or the map issue URL, ' +
				'or set CANVAS_TRACKER_REPO.',
		)
	}
	return { repo: resolved, number: ref.number }
}

export async function syncMap(
	tracker: TrackerOptions,
	target: { repo: RepoRef; number: number },
): Promise<SyncedMap> {
	const map = await loadWayfinderMap(await tracker.api(), target.repo, target.number)
	const derived = deriveMapGraph(map)
	if (!map.labels.some((l) => l.toLowerCase() === MAP_LABEL)) {
		derived.warnings.unshift(
			`the issue is not labelled ${MAP_LABEL}; its children were synced as the map's tickets anyway.`,
		)
	}
	return { map, derived }
}

/** Tool result text: what was synced, the frontier by name, each ticket's status and why. */
export function describeSync({ map, derived }: SyncedMap, renderSummary: string): string {
	const byId = new Map(derived.nodes.map((n) => [n.node.id, n]))
	const name = (id: string) => {
		const entry = byId.get(id)
		return entry ? `"${entry.ticket.title}" (${refOf(entry.ticket)})` : id
	}
	const lines = [
		`Synced the wayfinder map "${map.title}" (${formatRepo(map.repo)}#${map.number}) from GitHub Issues: ` +
			`${derived.nodes.length} tickets on the graph, ${derived.graph.edges.length} blocking edges.`,
		renderSummary,
		`Frontier (open, unblocked, unclaimed tickets, in map order; the first is next): ${
			derived.frontier.length > 0 ? derived.frontier.map(name).join(', ') : '(empty)'
		}.`,
		'Tickets:',
		...derived.nodes.map(({ ticket, node, reason }) => {
			const blockers = ticket.blockedBy.length
				? `; blocked by ${ticket.blockedBy.map((k) => refOf({ key: k })).join(', ')}`
				: ''
			const note = node.note ? `; note "${node.note}"` : ''
			return `- ${refOf(ticket)} "${ticket.title}": ${node.status} (${reason})${blockers}${note}`
		}),
		...(derived.leftOut.length
			? [
					'Left out of the graph (off the route):',
					...derived.leftOut.map(
						({ ticket, reason }) => `- ${refOf(ticket)} "${ticket.title}": ${reason}`,
					),
				]
			: []),
		...(derived.warnings.length ? ['Warnings:', ...derived.warnings.map((w) => `- ${w}`)] : []),
		'The tickets are the source of truth: record decisions on the tracker (comment, close, claim, ' +
			'blocking links), then call sync_wayfinder_map again to update the canvas.',
	]
	return lines.join('\n')
}
