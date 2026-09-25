import { describe, expect, it, vi } from 'vitest'
import { AgentApiClient } from '../../src/desktop/agentApiClient'

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	})
}

describe('AgentApiClient', () => {
	it('sends every request to 127.0.0.1 on the configured port, never localhost', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () =>
			jsonResponse(200, { success: true, result: { ok: true } }),
		)
		const client = new AgentApiClient({
			readConfig: async () => ({ port: 7236, token: 'tok' }),
			fetchImpl,
		})

		await client.search('return 1')

		expect(fetchImpl).toHaveBeenCalledTimes(1)
		const [url] = fetchImpl.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('http://127.0.0.1:7236/api/search')
	})

	it('sends the bearer token read fresh for every request, from readConfig', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () =>
			jsonResponse(200, { success: true, result: {} }),
		)
		let calls = 0
		const client = new AgentApiClient({
			readConfig: async () => ({ port: 7236, token: `tok-${++calls}` }),
			fetchImpl,
		})

		await client.search('return 1')
		await client.search('return 2')

		expect(calls).toBe(2)
		const headers = fetchImpl.mock.calls.map(([, init]) => (init as RequestInit).headers)
		expect((headers[0] as Record<string, string>).authorization).toBe('Bearer tok-1')
		expect((headers[1] as Record<string, string>).authorization).toBe('Bearer tok-2')
	})

	it('unwraps the "result" field of a successful response', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () =>
			jsonResponse(200, { success: true, result: { shapeId: 's1' } }),
		)
		const client = new AgentApiClient({
			readConfig: async () => ({ port: 1, token: 't' }),
			fetchImpl,
		})

		const result = await client.exec('doc1', 'return {}')

		expect(result).toEqual({ shapeId: 's1' })
		const [url] = fetchImpl.mock.calls[0] as [string]
		expect(url).toBe('http://127.0.0.1:1/api/doc/doc1/exec')
	})

	it('throws with the server error message on a non-2xx response', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () =>
			jsonResponse(401, { error: 'Unauthorized: bad token' }),
		)
		const client = new AgentApiClient({
			readConfig: async () => ({ port: 1, token: 't' }),
			fetchImpl,
		})

		await expect(client.search('return 1')).rejects.toThrow(/Unauthorized: bad token/)
	})

	it('throws when the response body says success: false, even on HTTP 200', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () =>
			jsonResponse(200, { success: false, error: 'already exists' }),
		)
		const client = new AgentApiClient({
			readConfig: async () => ({ port: 1, token: 't' }),
			fetchImpl,
		})

		await expect(client.createDoc({ name: 'x' })).rejects.toThrow(/already exists/)
	})

	it('never puts the token into a thrown error message', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(401, { error: 'Unauthorized' }))
		const client = new AgentApiClient({
			readConfig: async () => ({ port: 1, token: 'super-secret-token' }),
			fetchImpl,
		})

		await expect(client.search('return 1')).rejects.not.toThrow(/super-secret-token/)
	})

	it('GETs script-status without a body', async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () =>
			jsonResponse(200, { success: true, result: { state: 'applied' } }),
		)
		const client = new AgentApiClient({
			readConfig: async () => ({ port: 1, token: 't' }),
			fetchImpl,
		})

		await client.scriptStatus('doc1')

		const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('http://127.0.0.1:1/api/doc/doc1/script-status')
		expect(init.method).toBe('GET')
		expect(init.body).toBeUndefined()
	})
})
