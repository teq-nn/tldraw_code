import { describe, expect, it } from 'vitest'
import { readServerConfig } from '../../src/desktop/serverConfig'

describe('readServerConfig', () => {
	it('reads port and token from the given file', async () => {
		const config = await readServerConfig({
			path: '/fake/server.json',
			readFile: async (p) => {
				expect(p).toBe('/fake/server.json')
				return JSON.stringify({ port: 7236, token: 'abc123', pid: 1 })
			},
		})
		expect(config).toEqual({ port: 7236, token: 'abc123' })
	})

	it('reads the file fresh on every call (no caching of the token)', async () => {
		let calls = 0
		const readFile = async () => {
			calls++
			return JSON.stringify({ port: 7236, token: `token-${calls}` })
		}
		const first = await readServerConfig({ path: '/fake/server.json', readFile })
		const second = await readServerConfig({ path: '/fake/server.json', readFile })
		expect(first.token).toBe('token-1')
		expect(second.token).toBe('token-2')
		expect(calls).toBe(2)
	})

	it('reports a clear, tokenless error when the file cannot be read', async () => {
		await expect(
			readServerConfig({
				path: '/fake/server.json',
				readFile: async () => {
					throw new Error('ENOENT')
				},
			}),
		).rejects.toThrow(/tldraw offline is not running/)
	})

	it('reports a clear error for invalid JSON', async () => {
		await expect(
			readServerConfig({ path: '/fake/server.json', readFile: async () => 'not json' }),
		).rejects.toThrow(/not valid JSON/)
	})

	it('reports a clear error when port or token is missing', async () => {
		await expect(
			readServerConfig({
				path: '/fake/server.json',
				readFile: async () => JSON.stringify({ port: 7236 }),
			}),
		).rejects.toThrow(/missing "port" or "token"/)
	})
})
