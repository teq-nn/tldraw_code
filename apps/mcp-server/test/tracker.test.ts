import { describe, expect, it } from 'vitest'
import {
	createGitHubApi,
	deriveMapGraph,
	loadWayfinderMap,
	parseMapRef,
	parseRepo,
	type RepoRef,
} from '../src/tracker'
import { blockerRefs, decisionGists, issueRefs, taskListRefs } from '../src/tracker/markdown'
import { FakeGitHub } from './fakeGitHub'
import { STORAGE_MAP, storageMapIssues } from './fixtures/storageMap'

const repo: RepoRef = { owner: 'acme', name: 'plan' }

async function derive(github: FakeGitHub, map = STORAGE_MAP) {
	return deriveMapGraph(await loadWayfinderMap(github, repo, map))
}

function nodeById(derived: Awaited<ReturnType<typeof derive>>, id: string) {
	return derived.graph.nodes.find((n) => n.id === id)
}

describe('deriving the frontier graph from a wayfinder map', () => {
	it('turns every ticket on the route into a decision node, in map order', async () => {
		const derived = await derive(new FakeGitHub('acme/plan', storageMapIssues()))
		expect(derived.graph.nodes.map((n) => n.id)).toEqual([
			'2',
			'3',
			'4',
			'5',
			'6',
			'8',
			'9',
			'11',
			'13',
		])
		expect(nodeById(derived, '3')?.title).toBe('Schema per tenant?')
	})

	it('maps ticket state, labels and assignees to node status', async () => {
		const derived = await derive(new FakeGitHub('acme/plan', storageMapIssues()))
		const status = Object.fromEntries(derived.graph.nodes.map((n) => [n.id, n.status]))
		expect(status).toEqual({
			'2': 'resolved', // closed
			'3': 'open',
			'4': 'open', // open, but its blocker #3 is open: off the frontier through the edge
			'5': 'blocked', // claimed
			'6': 'blocked', // needs-info
			'8': 'open', // its only blocker was closed as not planned
			'9': 'blocked', // open blocker outside the map
			'11': 'open', // its blocker in another repo is closed
			'13': 'open',
		})
		expect(nodeById(derived, '2')?.note).toBe('Postgres, managed')
		expect(nodeById(derived, '5')?.note).toBe('Claimed by @ana')
		expect(nodeById(derived, '6')?.note).toBe('Labelled needs-info')
		expect(nodeById(derived, '9')?.note).toBe('Waiting on "Load test results"')
		expect(nodeById(derived, '3')?.note).toBeUndefined()
	})

	it('leaves out tickets closed as not planned and tickets ruled out of scope', async () => {
		const derived = await derive(new FakeGitHub('acme/plan', storageMapIssues()))
		expect(derived.leftOut.map(({ ticket, reason }) => [ticket.number, reason])).toEqual([
			[7, 'closed as not planned'],
			[12, 'listed under Out of scope on the map'],
		])
	})

	it('turns blocking links between tickets of the map into dependency edges', async () => {
		const derived = await derive(new FakeGitHub('acme/plan', storageMapIssues()))
		expect(derived.graph.edges).toEqual([
			{ from: '2', to: '3' }, // native dependency
			{ from: '3', to: '4' },
			{ from: '3', to: '13' }, // "## Blocked by" section
			{ from: '5', to: '13' },
		])
	})

	it('computes the frontier from open, unblocked, unclaimed tickets', async () => {
		const derived = await derive(new FakeGitHub('acme/plan', storageMapIssues()))
		expect(derived.frontier).toEqual(['3', '8', '11'])
	})

	it('reflects tracker changes on the next derivation', async () => {
		const github = new FakeGitHub('acme/plan', storageMapIssues())
		github.update(3, { state: 'closed', stateReason: 'completed' })
		github.update(5, { assignees: [] })
		github.update(STORAGE_MAP, {
			body: '## Decisions so far\n\n- [Schema per tenant?](https://github.com/acme/plan/issues/3): Yes, per tenant',
		})

		const derived = await derive(github)

		expect(nodeById(derived, '3')).toMatchObject({ status: 'resolved', note: 'Yes, per tenant' })
		expect(nodeById(derived, '5')?.status).toBe('open')
		// #12 is no longer ruled out in the map body, so it is back on the route.
		expect(derived.frontier).toEqual(['4', '5', '8', '11', '12'])
	})

	it('falls back to the task list and "Blocked by" lines without native links', async () => {
		const github = new FakeGitHub('acme/plan', [
			{ number: 20, title: 'Map', body: '## Tickets\n\n- [ ] #21\n- [x] #22\n- [ ] #23' },
			{ number: 21, title: 'First', body: 'Part of #20' },
			{ number: 22, title: 'Second', state: 'closed' },
			{ number: 23, title: 'Third', body: 'Part of #20\nBlocked by: #21, #22' },
		])
		github.nativeLinks = false

		const derived = await derive(github, 20)

		expect(derived.graph.nodes.map((n) => [n.id, n.status])).toEqual([
			['21', 'open'],
			['22', 'resolved'],
			['23', 'open'],
		])
		expect(derived.graph.edges).toEqual([
			{ from: '21', to: '23' },
			{ from: '22', to: '23' },
		])
		expect(derived.frontier).toEqual(['21'])
	})

	it('reads dependencies only for tickets GitHub reports as blocked', async () => {
		const github = new FakeGitHub('acme/plan', storageMapIssues())
		await derive(github)
		const depRequests = github.requests.filter((r) => r.includes('/dependencies/'))
		expect(depRequests.map((r) => /issues\/(\d+)/.exec(r)?.[1]).sort()).toEqual(['11', '3', '4'])
	})

	it('reports a missing map and a map without tickets as tool errors', async () => {
		const github = new FakeGitHub('acme/plan', [{ number: 30, title: 'Empty map' }])
		await expect(derive(github, 99)).rejects.toMatchObject({ code: 'map_not_found' })
		await expect(derive(github, 30)).rejects.toMatchObject({ code: 'empty_map' })
	})

	it('shortens long titles and gists to what a decision node holds', async () => {
		const long = 'x'.repeat(300)
		const github = new FakeGitHub('acme/plan', [
			{
				number: 40,
				title: 'Map',
				subIssues: [41],
				body: `## Decisions so far\n\n- [T](https://github.com/acme/plan/issues/41): ${long}`,
			},
			{ number: 41, title: long, state: 'closed' },
		])
		const node = (await derive(github, 40)).graph.nodes[0]
		expect(node?.title).toHaveLength(120)
		expect(node?.note).toHaveLength(200)
	})
})

describe('map body conventions', () => {
	it('finds references to issues of the same repository only', () => {
		expect(
			issueRefs(
				'#3, acme/plan#4, other/repo#5, https://github.com/acme/plan/issues/6, https://github.com/x/y/issues/7, a#8',
				repo,
			),
		).toEqual([3, 4, 6])
	})

	it('reads blockers from a "Blocked by:" line and a "Blocked by" section', () => {
		expect(
			blockerRefs('**Blocked by:** #1, #2\n\n## Blocked by\n\n- #3\n- #1\n\n## Next\n\n#9', repo),
		).toEqual([1, 2, 3])
		expect(blockerRefs('## Blocked by\n\nNone - can start immediately', repo)).toEqual([])
	})

	it('reads task-list children and decision gists from a map body', () => {
		expect(
			taskListRefs(
				'- [ ] #4 Title\n- [x] [Other](https://github.com/acme/plan/issues/5)\n- #6',
				repo,
			),
		).toEqual([4, 5])
		const gists = decisionGists(
			'## Decisions so far\n\n- [Storage: which?](https://github.com/acme/plan/issues/2): SQLite\n- Hosting (#3): Fly.io\n',
			repo,
		)
		expect([...gists]).toEqual([
			[2, 'SQLite'],
			[3, 'Fly.io'],
		])
	})
})

describe('naming repositories and maps', () => {
	it('parses owner/name and git remote URLs', () => {
		const expected = { owner: 'teq-nn', name: 'tldraw_code' }
		expect(parseRepo('teq-nn/tldraw_code')).toEqual(expected)
		expect(parseRepo('https://github.com/teq-nn/tldraw_code.git')).toEqual(expected)
		expect(parseRepo('git@github.com:teq-nn/tldraw_code.git\n')).toEqual(expected)
		expect(parseRepo('http://proxy@127.0.0.1:1234/git/teq-nn/tldraw_code')).toEqual(expected)
		expect(parseRepo('not a repo')).toBeUndefined()
	})

	it('parses a map given as number, #number, owner/name#number or URL', () => {
		expect(parseMapRef(12)).toEqual({ number: 12 })
		expect(parseMapRef('#12')).toEqual({ number: 12 })
		expect(parseMapRef('acme/plan#12')).toEqual({ number: 12, repo })
		expect(parseMapRef('https://github.com/acme/plan/issues/12')).toEqual({ number: 12, repo })
		expect(parseMapRef('twelve')).toBeUndefined()
	})
})

describe('GitHub API client', () => {
	function fakeFetch(status: number, body: unknown) {
		const calls: { url: string; headers: Record<string, string> }[] = []
		const fetch = (async (url: string, init?: RequestInit) => {
			calls.push({ url, headers: init?.headers as Record<string, string> })
			return new Response(JSON.stringify(body), { status })
		}) as typeof globalThis.fetch
		return { calls, fetch }
	}

	it('sends the token and parses JSON', async () => {
		const { calls, fetch } = fakeFetch(200, { number: 1 })
		const api = createGitHubApi({ token: 't0k', fetch })
		expect(await api.get('/repos/acme/plan/issues/1')).toEqual({ number: 1 })
		expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/plan/issues/1')
		expect(calls[0]?.headers.authorization).toBe('Bearer t0k')
	})

	it('returns undefined for 404 and a tracker_error with a hint otherwise', async () => {
		expect(await createGitHubApi({ fetch: fakeFetch(404, {}).fetch }).get('/x')).toBeUndefined()
		await expect(
			createGitHubApi({ fetch: fakeFetch(403, {}).fetch }).get('/x'),
		).rejects.toMatchObject({
			code: 'tracker_error',
			message: expect.stringContaining('GH_TOKEN'),
		})
	})
})
