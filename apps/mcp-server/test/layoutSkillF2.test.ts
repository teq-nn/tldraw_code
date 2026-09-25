import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { createMcpServer } from '../src/server'

// The canvas-layout skill variant for layout flavour F2 "user-owned space" (issue #28):
// a candidate next to the other flavours' variants, checked against the server like the canvas skills.

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const path = `${repoRoot}.agents/skills/canvas-layout-f2/SKILL.md`
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

async function toolNames(): Promise<string[]> {
	return (await listTools()).map((tool) => tool.name)
}

describe('canvas-layout skill, F2 variant', () => {
	it('has frontmatter naming the skill and saying when to use it', () => {
		const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? ''
		expect(frontmatter).toMatch(/^name: canvas-layout$/m)
		expect(frontmatter).toMatch(/^description: .*Use when/m)
	})

	it('says it is the F2 candidate and names the flavour the canvas runs it with', () => {
		expect(text).toMatch(/F2 candidate/)
		expect(text).toContain('?layout=user-owned')
	})

	it('stays out of .claude/skills until a variant is chosen, like the other variants', () => {
		expect(existsSync(`${repoRoot}.claude/skills/canvas-layout-f2`)).toBe(false)
	})

	it('only calls tools the MCP server offers, and checks the canvas after rendering', async () => {
		const offered = await toolNames()
		const called = [...text.matchAll(/[Cc]all `([a-z_]+)`/g)].map((match) => match[1])
		expect(called).toContain('render_graph')
		expect(called).toContain('read_canvas')
		for (const name of called) expect(offered).toContain(name)
	})

	it('runs a tidy with the option render_graph offers, and says when to offer one', async () => {
		const renderGraph = (await listTools()).find((tool) => tool.name === 'render_graph')
		expect(Object.keys(renderGraph?.inputSchema.properties ?? {})).toContain('tidy')
		const tidy = text.slice(text.indexOf('## Tidy'))
		expect(tidy).toContain('`tidy: true`')
		expect(tidy).toMatch(/\*\*Run one\*\* when the user asks/)
		expect(tidy).toMatch(/\*\*Offer one\*\* when/)
		expect(tidy).not.toMatch(/#29|not available/)
	})
})
