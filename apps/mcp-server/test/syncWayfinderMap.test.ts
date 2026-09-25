import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { makeOkResult } from '@tldraw-code/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { createMcpServer } from '../src/server'
import { FakeCanvas } from './fakeCanvas'
import { FakeGitHub } from './fakeGitHub'
import { STORAGE_MAP, storageMapIssues } from './fixtures/storageMap'

// The tracker sync through its public seam: a tool call in, tickets read from
// a fake GitHub, the derived graph out to a fake canvas tab.

let bridge: CanvasBridge
let client: Client
let canvas: FakeCanvas
let github: FakeGitHub

beforeEach(async () => {
	github = new FakeGitHub('acme/plan', storageMapIssues())
	bridge = new CanvasBridge({ port: 0, requestTimeoutMs: 200 })
	const port = await bridge.start()
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await createMcpServer(bridge, {
		tracker: {
			api: async () => github,
			repo: async () => ({ owner: 'acme', name: 'plan' }),
		},
	}).connect(serverTransport)
	client = new Client({ name: 'test', version: '0.0.0' })
	await client.connect(clientTransport)
	canvas = await FakeCanvas.connect(port)
	for (let i = 0; i < 100 && !bridge.isConnected(); i++) await new Promise((r) => setTimeout(r, 10))
	const none = { created: 0, updated: 0, removed: 0 }
	canvas.respondWith((command) => makeOkResult(command.id, { nodes: none, edges: none }))
})

afterEach(async () => {
	await client.close()
	await canvas.close()
	await bridge.stop()
})

async function sync(args: Record<string, unknown> = {}): Promise<CallToolResult> {
	return (await client.callTool({ name: 'sync_wayfinder_map', arguments: args })) as CallToolResult
}

function textOf(result: CallToolResult): string {
	return result.content.map((c) => (c.type === 'text' ? c.text : '')).join('')
}

function renders() {
	return canvas.commands.filter((c) => c.name === 'graph.render')
}

describe('sync_wayfinder_map', () => {
	it('is listed as a tool', async () => {
		const { tools } = await client.listTools()
		expect(tools.map((t) => t.name)).toContain('sync_wayfinder_map')
	})

	it('renders the tickets of the map as the frontier graph', async () => {
		const result = await sync({ map: STORAGE_MAP })

		expect(result.isError).toBeFalsy()
		expect(renders()).toHaveLength(1)
		expect(renders()[0]?.payload).toMatchObject({
			frontier: ['3', '8', '11'],
			edges: [
				{ from: '2', to: '3' },
				{ from: '3', to: '4' },
				{ from: '3', to: '13' },
				{ from: '5', to: '13' },
			],
		})
		expect(renders()[0]?.payload).toMatchObject({
			nodes: expect.arrayContaining([
				{ id: '2', title: 'Which database?', status: 'resolved', note: 'Postgres, managed' },
				{ id: '5', title: 'Hosting provider', status: 'in_progress', note: 'Claimed by @ana' },
			]),
		})
	})

	it('tells Claude the frontier by name and why each ticket has its status', async () => {
		const text = textOf(await sync({ map: 'https://github.com/acme/plan/issues/1' }))

		expect(text).toContain(
			'Synced the wayfinder map "Storage layer for the plan service" (acme/plan#1)',
		)
		expect(text).toContain(
			'the first is next): "Schema per tenant?" (#3), "Cache layer" (#8), "Connection pooling" (#11).',
		)
		expect(text).toContain('- #5 "Hosting provider": in_progress (claimed by @ana)')
		expect(text).toContain('- #7 "Use a graph database?": closed as not planned')
		expect(text).toContain('call sync_wayfinder_map again')
	})

	it('shows tracker changes on the canvas after the next sync', async () => {
		await sync({ map: '#1' })
		github.update(3, { state: 'closed' })
		github.update(4, { assignees: ['ana'] })

		const result = await sync() // defaults to the map of the last sync

		expect(result.isError).toBeFalsy()
		expect(renders()).toHaveLength(2)
		const second = renders()[1]?.payload as {
			nodes: { id: string; status: string }[]
			frontier: string[]
		}
		expect(second.nodes.find((n) => n.id === '3')?.status).toBe('resolved')
		expect(second.nodes.find((n) => n.id === '4')?.status).toBe('in_progress')
		expect(second.frontier).toEqual(['8', '11'])
	})

	it('asks the canvas for a tidy only when told to (ADR 0032)', async () => {
		await sync({ map: STORAGE_MAP })
		const result = await sync({ tidy: true })

		expect(result.isError).toBeFalsy()
		expect(renders()[0]?.payload).not.toHaveProperty('tidy')
		expect(renders()[1]?.payload).toMatchObject({ tidy: true, frontier: ['3', '8', '11'] })
	})

	it('warns when the issue is not labelled as a wayfinder map', async () => {
		github.update(STORAGE_MAP, { labels: [] })
		expect(textOf(await sync({ map: 1 }))).toContain('not labelled wayfinder:map')
	})

	it('reports tracker problems as tool errors without touching the canvas', async () => {
		const noMap = await sync()
		expect(noMap.isError).toBe(true)
		expect(textOf(noMap)).toMatch(/^\[invalid_map\]/)

		const missing = await sync({ map: 404 })
		expect(textOf(missing)).toMatch(/^\[map_not_found\]/)

		const badRepo = await sync({ map: 1, repo: 'nope' })
		expect(textOf(badRepo)).toMatch(/^\[invalid_map\]/)

		expect(renders()).toHaveLength(0)
	})
})
