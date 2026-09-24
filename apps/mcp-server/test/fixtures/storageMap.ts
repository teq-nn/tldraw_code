import type { FixtureIssue } from '../fakeGitHub'

/**
 * A wayfinder map on a fake tracker (`acme/plan`), covering every ticket state
 * the sync maps: resolved with a gist, open on and off the frontier, claimed,
 * labelled, closed as not planned, ruled out of scope, and blocked through
 * native dependencies, a `Blocked by:` line, a `## Blocked by` section and
 * blockers outside the map (open and closed, same and other repository).
 */
export const STORAGE_MAP = 1

export function storageMapIssues(): FixtureIssue[] {
	return [
		{
			number: 1,
			title: 'Storage layer for the plan service',
			labels: ['wayfinder:map'],
			subIssues: [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13],
			body: [
				'## Destination',
				'',
				'A spec for the storage layer.',
				'',
				'## Decisions so far',
				'',
				'- [Which database?](https://github.com/acme/plan/issues/2): Postgres, managed',
				'',
				'## Not yet specified',
				'',
				'- Retention of audit data',
				'',
				'## Out of scope',
				'',
				'- [Sharding](https://github.com/acme/plan/issues/12): not needed below 1 TB',
			].join('\n'),
		},
		{ number: 2, title: 'Which database?', state: 'closed', stateReason: 'completed' },
		{ number: 3, title: 'Schema per tenant?', blockedBy: [2] },
		{ number: 4, title: 'Migration tool', blockedBy: [3] },
		{ number: 5, title: 'Hosting provider', assignees: ['ana'] },
		{ number: 6, title: 'Backup policy', labels: ['wayfinder:grilling', 'needs-info'] },
		{ number: 7, title: 'Use a graph database?', state: 'closed', stateReason: 'not_planned' },
		{ number: 8, title: 'Cache layer', body: 'Blocked by: #7\n\n## Question\n\nRedis or none?' },
		{
			number: 9,
			title: 'Read replicas',
			body: '## Question\n\nDo we need them?\n\n## Blocked by\n\n- #10',
		},
		{ number: 10, title: 'Load test results' },
		{ number: 11, title: 'Connection pooling', blockedBy: ['acme/infra#4'] },
		{ number: 12, title: 'Sharding' },
		{
			number: 13,
			title: 'Search index',
			body: '## Question\n\nWhich engine?\n\n## Blocked by\n\n- #3\n- #5',
		},
		{ number: 4, repo: 'acme/infra', title: 'Provision the database', state: 'closed' },
	]
}
