import { ToolInputError } from '../errors'
import { formatRepo, type GitHubApi, parseRepo, type RepoRef } from './github'
import { blockerRefs, taskListRefs } from './markdown'

/**
 * Loading a wayfinder map (ADR 0012) from GitHub Issues: the map issue, its
 * child tickets and every ticket's blockers, as plain data for
 * `deriveMapGraph`. Follows the "Wayfinding operations" of
 * `docs/agents/issue-tracker.md`: children are sub-issues (or task-list items
 * of the map body), blockers are native issue dependencies (or a
 * `Blocked by` line / section in the ticket body).
 */

/** One issue on the tracker, reduced to what the graph needs. */
export interface Ticket {
	/** `12` for an issue of the map's repository, `owner/name#12` for another one. */
	key: string
	number: number
	repo: RepoRef
	title: string
	url: string
	state: 'open' | 'closed'
	/** GitHub's close reason: `completed`, `not_planned`, `duplicate`, or none. */
	stateReason?: string
	labels: string[]
	assignees: string[]
	/** Keys of the tickets that block this one (open or closed). */
	blockedBy: string[]
}

export interface WayfinderMap {
	repo: RepoRef
	number: number
	title: string
	url: string
	body: string
	labels: string[]
	/** The map's child tickets, in map order (sub-issue order, then task-list order). */
	tickets: Ticket[]
	/** Blockers that are not children of the map, by key. */
	outside: Map<string, Ticket>
	/** Things that could not be read; reported to Claude, not fatal. */
	warnings: string[]
}

/** The subset of GitHub's issue object this module reads. */
export interface GitHubIssue {
	number: number
	title: string
	html_url: string
	state: string
	state_reason?: string | null
	body?: string | null
	labels?: (string | { name?: string })[]
	assignees?: { login: string }[] | null
	repository_url?: string
	pull_request?: unknown
	issue_dependencies_summary?: { total_blocked_by?: number }
}

const PAGE_SIZE = 100
const MAX_PAGES = 5

export function ticketKey(mapRepo: RepoRef, repo: RepoRef, number: number): string {
	return sameRepo(mapRepo, repo) ? String(number) : `${formatRepo(repo)}#${number}`
}

function sameRepo(a: RepoRef, b: RepoRef): boolean {
	return formatRepo(a).toLowerCase() === formatRepo(b).toLowerCase()
}

export async function loadWayfinderMap(
	api: GitHubApi,
	repo: RepoRef,
	mapNumber: number,
): Promise<WayfinderMap> {
	const issuePath = (r: RepoRef, n: number) => `/repos/${formatRepo(r)}/issues/${n}`
	const warnings: string[] = []

	const mapIssue = await api.get<GitHubIssue>(issuePath(repo, mapNumber))
	if (!mapIssue || mapIssue.pull_request) {
		throw new ToolInputError(
			'map_not_found',
			`${formatRepo(repo)} has no issue #${mapNumber}. Pass the number or URL of the wayfinder map issue.`,
		)
	}
	const mapBody = mapIssue.body ?? ''

	// Children: native sub-issues first, then task-list items of the map body.
	const children: GitHubIssue[] = []
	for (let page = 1; page <= MAX_PAGES; page++) {
		const batch = await api.get<GitHubIssue[]>(
			`${issuePath(repo, mapNumber)}/sub_issues?per_page=${PAGE_SIZE}&page=${page}`,
		)
		if (!batch) break
		children.push(...batch)
		if (batch.length < PAGE_SIZE) break
	}
	const childNumbers = new Set(
		children.filter((c) => sameRepo(repoOf(c, repo), repo)).map((c) => c.number),
	)
	const listed = taskListRefs(mapBody, repo).filter((n) => !childNumbers.has(n) && n !== mapNumber)
	const listedIssues = await Promise.all(
		listed.map((n) => api.get<GitHubIssue>(issuePath(repo, n))),
	)
	listedIssues.forEach((issue, i) => {
		if (!issue) warnings.push(`task-list item #${listed[i]} of the map is not an issue; skipped.`)
		else if (issue.pull_request)
			warnings.push(`task-list item #${issue.number} is a pull request; skipped.`)
		else children.push(issue)
	})

	// Blockers of every child: native dependencies plus the body convention.
	const known = new Map<string, GitHubIssue>()
	const keyOf = (issue: GitHubIssue) => ticketKey(repo, repoOf(issue, repo), issue.number)
	for (const child of children) known.set(keyOf(child), child)

	const tickets = await Promise.all(
		children.map(async (child) => {
			const childRepo = repoOf(child, repo)
			const blockers = blockerRefs(child.body ?? '', childRepo).map((n) =>
				ticketKey(repo, childRepo, n),
			)
			const summary = child.issue_dependencies_summary
			if (!summary || (summary.total_blocked_by ?? 0) > 0) {
				const native = await api.get<GitHubIssue[]>(
					`${issuePath(childRepo, child.number)}/dependencies/blocked_by?per_page=${PAGE_SIZE}`,
				)
				for (const blocker of native ?? []) {
					const key = keyOf(blocker)
					if (!known.has(key)) known.set(key, blocker)
					blockers.push(key)
				}
			}
			return toTicket(
				child,
				repo,
				[...new Set(blockers)].filter((k) => k !== keyOf(child)),
			)
		}),
	)

	// Blockers outside the map: read their state, so an open one can gate its dependent.
	const childKeys = new Set(tickets.map((t) => t.key))
	const missing = [...new Set(tickets.flatMap((t) => t.blockedBy))].filter(
		(key) => !childKeys.has(key) && !known.has(key),
	)
	await Promise.all(
		missing.map(async (key) => {
			const ref = parseKey(key, repo)
			const issue = ref && (await api.get<GitHubIssue>(issuePath(ref.repo, ref.number)))
			if (issue) known.set(key, issue)
			else
				warnings.push(`blocker ${key.includes('#') ? key : `#${key}`} could not be read; ignored.`)
		}),
	)
	const outside = new Map<string, Ticket>()
	for (const [key, issue] of known) {
		if (!childKeys.has(key)) outside.set(key, toTicket(issue, repo, []))
	}

	return {
		repo,
		number: mapIssue.number,
		title: mapIssue.title,
		url: mapIssue.html_url,
		body: mapBody,
		labels: labelNames(mapIssue),
		tickets,
		outside,
		warnings,
	}
}

function toTicket(issue: GitHubIssue, mapRepo: RepoRef, blockedBy: string[]): Ticket {
	const repo = repoOf(issue, mapRepo)
	return {
		key: ticketKey(mapRepo, repo, issue.number),
		number: issue.number,
		repo,
		title: issue.title,
		url: issue.html_url,
		state: issue.state === 'closed' ? 'closed' : 'open',
		...(issue.state_reason ? { stateReason: issue.state_reason } : {}),
		labels: labelNames(issue),
		assignees: (issue.assignees ?? []).map((a) => a.login),
		blockedBy,
	}
}

function labelNames(issue: GitHubIssue): string[] {
	return (issue.labels ?? [])
		.map((label) => (typeof label === 'string' ? label : (label.name ?? '')))
		.filter(Boolean)
}

function repoOf(issue: GitHubIssue, fallback: RepoRef): RepoRef {
	const fromUrl = issue.repository_url && parseRepo(issue.repository_url)
	return fromUrl || fallback
}

function parseKey(key: string, mapRepo: RepoRef): { repo: RepoRef; number: number } | undefined {
	if (/^\d+$/.test(key)) return { repo: mapRepo, number: Number(key) }
	const [repoPart, num] = key.split('#')
	const repo = repoPart ? parseRepo(repoPart) : undefined
	return repo && num ? { repo, number: Number(num) } : undefined
}

/**
 * Which map a `sync_wayfinder_map` argument names: a number, `#12`, or an
 * issue URL (which also names the repository).
 */
export function parseMapRef(
	value: number | string,
): { number: number; repo?: RepoRef } | undefined {
	if (typeof value === 'number')
		return Number.isInteger(value) && value > 0 ? { number: value } : undefined
	const trimmed = value.trim()
	const plain = /^#?(\d+)$/.exec(trimmed)
	if (plain) return { number: Number(plain[1]) }
	const url = /^https?:\/\/[^/\s]+\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)/.exec(
		trimmed,
	)
	if (url?.[1] && url[2]) {
		return { number: Number(url[3]), repo: { owner: url[1], name: url[2] } }
	}
	const qualified = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)$/.exec(trimmed)
	if (qualified?.[1] && qualified[2]) {
		return { number: Number(qualified[3]), repo: { owner: qualified[1], name: qualified[2] } }
	}
	return undefined
}
