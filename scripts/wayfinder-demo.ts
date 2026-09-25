/**
 * A scripted canvas wayfinder session, end to end, without Claude Code and
 * without touching a real tracker: this script plays Claude following the
 * `canvas-wayfinder` skill, over stdio against the real MCP server, and you
 * answer on the canvas. The tickets live in a fixture file the server reads
 * (CANVAS_TRACKER_FIXTURE, ADR 0023); the script's tracker writes (claim,
 * close, Decisions so far, new tickets) edit that file.
 *
 *   pnpm dev                # in one terminal; open http://127.0.0.1:5173
 *   pnpm demo:wayfinder     # in another
 *
 * The session: the map "Settings sync" has three tickets. The first is a
 * structure question, asked as a comparison of two data-flow diagrams; the
 * second a UI question, asked as a comparison of two clickable prototypes.
 * After each answer the choice is settled on the canvas (chosen pinned to the
 * ticket's node, the other collapsed with its reason) and the map re-synced.
 * "Keep grilling" on the first adds a narrower ticket in front of it.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

interface Issue {
	number: number
	title: string
	state?: 'open' | 'closed'
	body?: string
	labels?: string[]
	assignees?: string[]
	blockedBy?: number[]
	subIssues?: number[]
}

const REPO = 'demo/settings'
const MAP = 1
const ME = 'claude'
const WAIT_FOR_CANVAS_MS = 60_000

const mapBody = (decisions: string[]) =>
	[
		'## Destination',
		'',
		'A spec for syncing user settings across devices.',
		'',
		'## Decisions so far',
		'',
		...decisions,
		'',
		'## Not yet specified',
		'',
		'- Conflict resolution between two devices',
	].join('\n')

const issues: Issue[] = [
	{
		number: MAP,
		title: 'Settings sync',
		labels: ['wayfinder:map'],
		subIssues: [2, 3, 4],
		body: mapBody([]),
	},
	{
		number: 2,
		title: 'How do settings changes reach the server?',
		labels: ['wayfinder:grilling'],
		body: '## Question\n\nWrite straight to the database, or through a queue?',
	},
	{
		number: 3,
		title: 'Settings page layout',
		labels: ['wayfinder:prototype'],
		blockedBy: [2],
		body: '## Question\n\nTabs per area, or one long page?',
	},
	{
		number: 4,
		title: 'Rollout plan',
		labels: ['wayfinder:grilling'],
		blockedBy: [3],
		body: '## Question\n\nBehind a flag, or for everyone at once?',
	},
]
const decisions: string[] = []

const fixturePath = join(mkdtempSync(join(tmpdir(), 'wayfinder-demo-')), 'tracker.json')
const writeTracker = () =>
	writeFileSync(fixturePath, JSON.stringify({ repo: REPO, issues }, null, '\t'))
writeTracker()

const issue = (number: number) => {
	const found = issues.find((i) => i.number === number)
	if (!found) throw new Error(`no issue #${number}`)
	return found
}
const tracker = {
	claim(number: number) {
		issue(number).assignees = [ME]
		writeTracker()
		status(`Claimed #${number} "${issue(number).title}"`)
	},
	resolve(number: number, gist: string) {
		const ticket = issue(number)
		ticket.state = 'closed'
		decisions.push(`- [${ticket.title}](https://github.com/${REPO}/issues/${number}): ${gist}`)
		issue(MAP).body = mapBody(decisions)
		writeTracker()
		status(`Resolved #${number}: ${gist}`)
	},
	/** Create a narrower ticket blocking `parent`, claimed at once (create-then-wire). */
	narrower(parent: number, title: string, question: string): number {
		const number = Math.max(...issues.map((i) => i.number)) + 1
		issues.push({
			number,
			title,
			labels: ['wayfinder:grilling'],
			assignees: [ME],
			body: `## Question\n\n${question}`,
		})
		issue(MAP).subIssues?.push(number)
		const blocked = issue(parent)
		blocked.blockedBy = [...(blocked.blockedBy ?? []), number]
		writeTracker()
		status(`Added #${number} "${title}", blocking #${parent}`)
		return number
	},
}

function status(line: string) {
	console.log(`[wayfinder-demo] ${line}`)
}

const transport = new StdioClientTransport({
	command: process.execPath,
	args: ['--import', 'tsx', 'apps/mcp-server/src/main.ts'],
	env: { ...process.env, CANVAS_TRACKER_FIXTURE: fixturePath } as Record<string, string>,
	stderr: 'inherit',
})
const client = new Client({ name: 'wayfinder-demo', version: '0.0.0' })
await client.connect(transport)

const textOf = (result: CallToolResult) =>
	result.content.map((c) => (c.type === 'text' ? c.text : '')).join('')

async function call(name: string, args: Record<string, unknown>): Promise<string> {
	const result = (await client.callTool({ name, arguments: args }, undefined, {
		timeout: 24 * 60 * 60_000,
		resetTimeoutOnProgress: true,
	})) as CallToolResult
	const text = textOf(result)
	if (result.isError) throw new Error(`${name} failed: ${text}`)
	return text
}

/** A blocking question (ask or compare), repeated with the same arguments until answered. */
async function question(name: 'ask' | 'compare', args: Record<string, unknown>): Promise<string> {
	for (;;) {
		const text = await call(name, args)
		if (!text.includes('No answer yet')) return text
		status('No answer yet; still waiting on the canvas')
	}
}

/** What the user chose: an option label, "Keep grilling", or a sticky note's text. */
function answerOf(
	text: string,
	labels: string[],
): { kind: 'option' | 'keep' | 'note'; value: string } {
	if (text.includes('The user chose "Keep grilling"')) return { kind: 'keep', value: '' }
	const note = /answered with a sticky note instead of an option: "([\s\S]*)"/.exec(text)
	if (note?.[1]) return { kind: 'note', value: note[1] }
	const chosen = labels.find((label) => text.includes(`The user chose: ${label}`))
	return { kind: 'option', value: chosen ?? labels[0] ?? '' }
}

const sync = () => call('sync_wayfinder_map', { map: `${REPO}#${MAP}` })

// 1. Load: the map on the canvas (wait for the tab to connect).
status(`Tracker fixture: ${fixturePath}`)
const deadline = Date.now() + WAIT_FOR_CANVAS_MS
for (;;) {
	try {
		await sync()
		break
	} catch (error) {
		if (!String(error).includes('not_connected') || Date.now() > deadline) throw error
		status('Waiting for the canvas: run `pnpm dev` and open http://127.0.0.1:5173')
		await new Promise((resolve) => setTimeout(resolve, 1000))
	}
}
status('Map on the canvas')

/** Close a ticket's session: offer the next frontier ticket. True means "Take it". */
async function takeNext(title: string): Promise<boolean> {
	await call('read_canvas', { screenshot: false })
	const text = await question('ask', {
		question: `Take the next frontier ticket, ${title}?`,
		options: ['Take it', 'Stop here'],
		recommendation: 'Stop here',
	})
	return answerOf(text, ['Take it', 'Stop here']).value === 'Take it'
}

// 2-6. Ticket #2, a structure question: two data flows as diagrams.
tracker.claim(2)
await sync()
const flows = {
	id: '2',
	question: 'How should settings changes reach the server?',
	items: [
		{
			label: 'Direct writes',
			caption: 'The API writes each change to the database.',
			spec: {
				nodes: [
					{ id: 'app', label: 'Settings page' },
					{ id: 'api', label: 'Settings API' },
					{ id: 'db', label: 'Database', look: 'ellipse' },
				],
				edges: [
					{ from: 'app', to: 'api', label: 'PATCH' },
					{ from: 'api', to: 'db', label: 'write' },
				],
			},
		},
		{
			label: 'Queued writes',
			caption: 'Changes go through a queue; a worker writes them.',
			spec: {
				nodes: [
					{ id: 'app', label: 'Settings page' },
					{ id: 'api', label: 'Settings API' },
					{ id: 'queue', label: 'Change queue' },
					{ id: 'worker', label: 'Sync worker' },
					{ id: 'db', label: 'Database', look: 'ellipse' },
				],
				edges: [
					{ from: 'app', to: 'api', label: 'PATCH' },
					{ from: 'api', to: 'queue', label: 'enqueue' },
					{ from: 'queue', to: 'worker' },
					{ from: 'worker', to: 'db', label: 'write' },
				],
			},
		},
	],
	recommendation: 'Direct writes',
}
const flowReasons: Record<string, string> = {
	'Direct writes': 'A slow database write blocks the settings page',
	'Queued writes': 'A queue and a worker to run for a few writes a minute',
}
for (;;) {
	await call('read_canvas', { screenshot: false })
	const answer = answerOf(await question('compare', flows), ['Direct writes', 'Queued writes'])
	if (answer.kind === 'keep') {
		// A narrower decision first: its own ticket, claimed, asked as a card.
		const narrower = tracker.narrower(
			2,
			'Must settings work offline?',
			'Do changes made offline have to reach the server later?',
		)
		await sync()
		await call('read_canvas', { screenshot: false })
		const offline = answerOf(
			await question('ask', {
				question: 'Must settings changes made offline reach the server later?',
				options: ['Yes, queue them', 'No, online only'],
				recommendation: 'No, online only',
			}),
			['Yes, queue them', 'No, online only'],
		)
		tracker.resolve(narrower, offline.value || 'No, online only')
		await sync()
		continue
	}
	const chosen = answer.kind === 'option' ? answer.value : flows.recommendation
	await call('settle_comparison', {
		id: '2',
		chosen,
		rejected: flows.items
			.filter((item) => item.label !== chosen)
			.map((item) => ({ label: item.label, reason: flowReasons[item.label] })),
	})
	tracker.resolve(2, answer.kind === 'note' ? answer.value.slice(0, 120) : chosen)
	await sync()
	break
}

// 7. Next ticket? The layout is on the frontier now.
if (await takeNext('Settings page layout')) {
	// Ticket #3, a UI question: two clickable prototypes.
	tracker.claim(3)
	await sync()
	const page = (body: string) =>
		`<!doctype html><html><head><style>
body{margin:0;font:14px system-ui,sans-serif;color:#1d2130;background:#fff}
header{padding:12px 16px;border-bottom:1px solid #e3e5ea;font-weight:600}
nav{display:flex;gap:4px;padding:8px 16px;border-bottom:1px solid #e3e5ea}
nav button{border:0;background:none;padding:6px 10px;border-radius:6px;cursor:pointer}
nav button.on{background:#ebe6f8;color:#5b3fb0}
section{padding:12px 16px}h3{margin:12px 0 6px;font-size:13px;color:#5b6070}
label{display:flex;justify-content:space-between;padding:6px 0}
</style></head><body><header>Settings</header>${body}</body></html>`
	const area = (name: string, rows: string[]) =>
		`<h3>${name}</h3>${rows.map((row) => `<label>${row}<input type="checkbox" checked></label>`).join('')}`
	const areas: [string, string[]][] = [
		['Profile', ['Show my name', 'Show my photo']],
		['Notifications', ['Email', 'Push']],
		['Privacy', ['Share usage data']],
	]
	const tabs = page(
		`<nav>${areas.map(([name], i) => `<button class="${i === 0 ? 'on' : ''}" onclick="show(${i})">${name}</button>`).join('')}</nav>` +
			areas
				.map(
					([name, rows], i) =>
						`<section id="s${i}" ${i ? 'hidden' : ''}>${area(name, rows)}</section>`,
				)
				.join('') +
			`<script>function show(i){document.querySelectorAll('section').forEach((s,j)=>s.hidden=i!==j);document.querySelectorAll('nav button').forEach((b,j)=>b.className=i===j?'on':'')}</script>`,
	)
	const single = page(
		`<section>${areas.map(([name, rows]) => area(name, rows)).join('')}</section>`,
	)
	const layouts = {
		id: '3',
		question: 'Which settings page layout?',
		items: [
			{ label: 'Tabs per area', caption: 'One tab per settings area.', html: tabs },
			{ label: 'One long page', caption: 'Every area on one scrolling page.', html: single },
		],
		recommendation: 'One long page',
	}
	const layoutReasons: Record<string, string> = {
		'Tabs per area': 'Hides most settings behind a click',
		'One long page': 'Gets long once more areas are added',
	}
	await call('read_canvas', { screenshot: false })
	const answer = answerOf(await question('compare', layouts), ['Tabs per area', 'One long page'])
	const chosen = answer.kind === 'option' ? answer.value : layouts.recommendation
	await call('settle_comparison', {
		id: '3',
		chosen,
		rejected: layouts.items
			.filter((item) => item.label !== chosen)
			.map((item) => ({ label: item.label, reason: layoutReasons[item.label] })),
	})
	tracker.resolve(3, chosen)
	await sync()
	await takeNext('Rollout plan')
}

// Stop here: one last sync removes the last card.
await sync()
status(`Session done. Tracker fixture: ${fixturePath}`)
await client.close()
process.exit(0)
