import { readFile } from 'node:fs/promises'
import { ToolInputError } from '../errors'
import type { GitHubApi } from './github'
import type { GitHubIssue } from './loadMap'

// A tracker that lives in memory or in a JSON file instead of on GitHub
// (ADR 0023): the tests' fixture tracker, and CANVAS_TRACKER_FIXTURE for
// demos and end-to-end runs that must not write to a real tracker.

/** A ticket in a fixture, in compact form; {@link FixtureGitHub} serves it as a GitHub issue object. */
export interface FixtureIssue {
	number: number
	title: string
	/** `owner/name`; defaults to the fake's repository. */
	repo?: string
	state?: 'open' | 'closed'
	stateReason?: 'completed' | 'not_planned' | 'duplicate'
	body?: string
	labels?: string[]
	assignees?: string[]
	/** Native issue dependencies ("blocked by"), as `#n` of the same repo or `owner/name#n`. */
	blockedBy?: (number | string)[]
	/** Child tickets linked as native sub-issues, in order. */
	subIssues?: (number | string)[]
}

/**
 * Stand-in for the GitHub REST API: serves the few endpoints the tracker sync
 * reads from an in-memory set of issues, and records every request. Tests
 * mutate {@link issues} between syncs to play "the tracker changed".
 */
export class FixtureGitHub implements GitHubApi {
	readonly issues = new Map<string, FixtureIssue>()
	readonly requests: string[] = []
	/** False plays a repository without sub-issues and dependencies (404 on those endpoints). */
	nativeLinks = true

	constructor(
		readonly repo = 'acme/plan',
		issues: FixtureIssue[] = [],
	) {
		for (const issue of issues) this.put(issue)
	}

	put(issue: FixtureIssue): void {
		this.issues.set(this.key(issue.repo ?? this.repo, issue.number), issue)
	}

	/** Change an issue in place, e.g. close it. */
	update(number: number, change: Partial<FixtureIssue>, repo = this.repo): void {
		const issue = this.issues.get(this.key(repo, number))
		if (!issue) throw new Error(`no fixture issue ${repo}#${number}`)
		Object.assign(issue, change)
	}

	async get<T>(path: string): Promise<T | undefined> {
		this.requests.push(path)
		const match = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)(\/[a-z_/]+)?(?:\?(.*))?$/.exec(path)
		if (!match) throw new Error(`unexpected GitHub request ${path}`)
		const [, repo = '', number, sub, query] = match
		const issue = this.issues.get(this.key(repo, Number(number)))
		if (!issue) return undefined
		const page = Number(new URLSearchParams(query).get('page') ?? '1')
		if (sub === undefined) return this.toGitHub(issue) as T
		if (!this.nativeLinks) return undefined
		if (sub === '/sub_issues') {
			if (page > 1) return [] as T
			return this.resolve(issue.subIssues ?? [], repo).map((i) => this.toGitHub(i)) as T
		}
		if (sub === '/dependencies/blocked_by') {
			return this.resolve(issue.blockedBy ?? [], repo).map((i) => this.toGitHub(i)) as T
		}
		throw new Error(`unexpected GitHub request ${path}`)
	}

	private resolve(refs: (number | string)[], repo: string): FixtureIssue[] {
		return refs.map((ref) => {
			const [r, n] = typeof ref === 'number' ? [repo, ref] : (ref.split('#') as [string, string])
			const issue = this.issues.get(this.key(r, Number(n)))
			if (!issue) throw new Error(`fixture references missing issue ${ref}`)
			return issue
		})
	}

	private toGitHub(issue: FixtureIssue): GitHubIssue {
		const repo = issue.repo ?? this.repo
		const blockers = this.nativeLinks ? this.resolve(issue.blockedBy ?? [], repo) : []
		return {
			number: issue.number,
			title: issue.title,
			html_url: `https://github.com/${repo}/issues/${issue.number}`,
			repository_url: `https://api.github.com/repos/${repo}`,
			state: issue.state ?? 'open',
			state_reason: issue.state === 'closed' ? (issue.stateReason ?? 'completed') : null,
			body: issue.body ?? null,
			labels: (issue.labels ?? []).map((name) => ({ name })),
			assignees: (issue.assignees ?? []).map((login) => ({ login })),
			...(this.nativeLinks
				? {
						issue_dependencies_summary: {
							blocked_by: blockers.filter((b) => (b.state ?? 'open') === 'open').length,
							total_blocked_by: blockers.length,
						},
					}
				: {}),
		} as GitHubIssue
	}

	private key(repo: string, number: number): string {
		return `${repo.toLowerCase()}#${number}`
	}
}

/** A fixture file: the repository the issues belong to by default, and the issues. */
export interface TrackerFixture {
	repo: string
	issues: FixtureIssue[]
}

/**
 * A read-only tracker served from a JSON {@link TrackerFixture} file, re-read
 * on every request, so whoever edits the file (a demo script playing Claude's
 * tracker writes) changes what the next sync sees.
 */
export function fixtureFileApi(path: string): GitHubApi {
	return {
		async get<T>(request: string): Promise<T | undefined> {
			const fixture = await readFixture(path)
			return new FixtureGitHub(fixture.repo, fixture.issues).get<T>(request)
		},
	}
}

export async function readFixture(path: string): Promise<TrackerFixture> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as TrackerFixture
	} catch (error) {
		throw new ToolInputError(
			'tracker_error',
			`could not read the tracker fixture ${path} (CANVAS_TRACKER_FIXTURE): ${(error as Error).message}`,
		)
	}
}
