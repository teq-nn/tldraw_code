import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { createMcpServer } from '../src/server'

// The canvas-layout skill (ADR 0032, issue #30): how Claude keeps the user-owned
// canvas stable, checked against the server like the other canvas skills.

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const path = `${repoRoot}.agents/skills/canvas-layout/SKILL.md`
const text = readFileSync(path, 'utf8')

async function listTools() {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await createMcpServer(new CanvasBridge({ port: 0 })).connect(serverTransport)
	const client = new Client({ name: 'test', version: '0.0.0' })
	await client.connect(clientTransport)
	const { tools } = await client.listTools()
	await client.close()
	return tools
}

describe('canvas-layout skill', () => {
	it('has frontmatter naming the skill and saying when to use it', () => {
		const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
		expect(frontmatter).toMatch(/^name: canvas-layout$/m)
		expect(frontmatter).toMatch(/^description: .*Use when/m)
	})

	it('is the same file for Claude Code (.claude/skills links to .agents/skills)', () => {
		const linked = realpathSync(`${repoRoot}.claude/skills/canvas-layout/SKILL.md`)
		expect(linked).toBe(realpathSync(path))
	})

	it('describes the one layout the canvas runs, not a candidate or a flavour switch', () => {
		expect(text).not.toMatch(/candidate|flavour|\?layout=/i)
		expect(text).toContain('ADR 0032')
	})

	it('only calls tools the MCP server offers, and checks the canvas after rendering', async () => {
		const offered = (await listTools()).map((tool) => tool.name)
		const called = [...text.matchAll(/[Cc]all `([a-z_]+)`/g)].map((match) => match[1])
		expect(called).toContain('render_graph')
		expect(called).toContain('sync_wayfinder_map')
		expect(called).toContain('read_canvas')
		for (const name of called) expect(offered).toContain(name)
	})

	it('runs a tidy with the option both graph tools offer, and says when to offer one', async () => {
		const tools = await listTools()
		for (const name of ['render_graph', 'sync_wayfinder_map']) {
			const tool = tools.find((t) => t.name === name)
			expect(Object.keys(tool?.inputSchema.properties ?? {})).toContain('tidy')
		}
		const tidy = text.slice(text.indexOf('## Tidy'))
		expect(tidy).toContain('`tidy: true`')
		expect(tidy).toMatch(/\*\*Run one\*\* when the user asks/)
		expect(tidy).toMatch(/\*\*Offer one\*\* when/)
		expect(tidy).not.toMatch(/#29|not available/)
	})
})
