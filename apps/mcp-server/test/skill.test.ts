import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { KEEP_GRILLING_LABEL } from '@tldraw-code/protocol'
import { describe, expect, it } from 'vitest'
import { CanvasBridge } from '../src/bridge'
import { createMcpServer } from '../src/server'

// The canvas grilling skill (ADR 0010) drives the tools by name and quotes
// their behaviour; these checks catch the skill drifting from the server.

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const skillPath = `${repoRoot}.agents/skills/canvas-grilling/SKILL.md`
const skill = readFileSync(skillPath, 'utf8')

async function toolNames(): Promise<string[]> {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await createMcpServer(new CanvasBridge({ port: 0 })).connect(serverTransport)
	const client = new Client({ name: 'test', version: '0.0.0' })
	await client.connect(clientTransport)
	const { tools } = await client.listTools()
	await client.close()
	return tools.map((tool) => tool.name)
}

describe('canvas-grilling skill', () => {
	it('has frontmatter naming the skill and saying when to use it', () => {
		const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? ''
		expect(frontmatter).toMatch(/^name: canvas-grilling$/m)
		expect(frontmatter).toMatch(/^description: .*Use when/m)
	})

	it('is the same file for Claude Code (.claude/skills links to .agents/skills)', () => {
		const linked = realpathSync(`${repoRoot}.claude/skills/canvas-grilling/SKILL.md`)
		expect(linked).toBe(realpathSync(skillPath))
	})

	it('only calls tools the MCP server offers, and uses ask, compare, render_graph, read_canvas and the tracker sync', async () => {
		const offered = await toolNames()
		const called = [...skill.matchAll(/[Cc]all `([a-z_]+)`/g)].map((match) => match[1])
		expect(new Set(called)).toEqual(
			new Set([
				'render_graph',
				'read_canvas',
				'ask',
				'compare',
				'render_diagram',
				'sync_wayfinder_map',
			]),
		)
		for (const name of called) expect(offered).toContain(name)
	})

	it('quotes the label of the extra button on every question card', () => {
		expect(skill).toContain(KEEP_GRILLING_LABEL)
	})
})
