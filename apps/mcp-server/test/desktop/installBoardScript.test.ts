import { describe, expect, it } from 'vitest'
import { installBoardScript } from '../../src/desktop/installBoardScript'
import { FakeAgentApi } from './installBoardScript'

const bundle = { configJs: 'export default () => {}', mainJs: 'export default () => {}' }

function writer() {
	const written = new Map<string, string>()
	const writeFile = async (path: string, content: string) => {
		written.set(path, content)
	}
	return { written, writeFile }
}

describe('installBoardScript', () => {
	it('creates the session document when none exists, writes the bundle, and saves', async () => {
		const client = new FakeAgentApi()
		const { written, writeFile } = writer()

		const result = await installBoardScript(client, bundle, {
			docName: 'tldraw-code session',
			writeFile,
			sleep: async () => {},
		})

		expect(client.created).toEqual([{ name: 'tldraw-code session' }])
		expect(result.docId).toBe('doc:tldraw-code session')
		expect(result.filePath).toBe('/fake/tldraw-code session.tldraw')
		expect(written.get('/fake/doc:tldraw-code session/script/main.js')).toBe(bundle.mainJs)
		expect(written.get('/fake/doc:tldraw-code session/script/config.js')).toBe(bundle.configJs)
		expect(client.writes).toEqual([
			{ docId: 'doc:tldraw-code session', code: 'await helpers.saveDoc()' },
		])
	})

	it('reuses an existing local document with an exact (case-insensitive) name match', async () => {
		// getDocs reports `name` without the `.tldraw` extension (verified against
		// the running app), regardless of how the document was originally named.
		const client = new FakeAgentApi()
		client.docs.push({
			id: 'doc:existing',
			name: 'Tldraw-Code Session',
			ownership: 'local',
			filePath: '/fake/existing.tldraw',
			documentId: 'did:existing',
			unsavedChanges: false,
		})
		const { writeFile } = writer()

		const result = await installBoardScript(client, bundle, {
			docName: 'tldraw-code session',
			writeFile,
			sleep: async () => {},
		})

		expect(client.created).toEqual([])
		expect(result.docId).toBe('doc:existing')
	})

	it('passes the directory through when creating a new document', async () => {
		const client = new FakeAgentApi()
		const { writeFile } = writer()

		await installBoardScript(client, bundle, {
			docName: 'session',
			directory: '/home/user/Documents',
			writeFile,
			sleep: async () => {},
		})

		expect(client.created).toEqual([{ name: 'session', directory: '/home/user/Documents' }])
	})

	it('polls script-status until it applies', async () => {
		const client = new FakeAgentApi()
		client.statuses = [{ state: 'pending' }, { state: 'pending' }, { state: 'applied' }]
		const { writeFile } = writer()
		const waits: number[] = []

		await installBoardScript(client, bundle, {
			docName: 'session',
			writeFile,
			pollIntervalMs: 50,
			sleep: async (ms) => {
				waits.push(ms)
			},
		})

		expect(waits).toEqual([50, 50])
	})

	it('throws with the apply error when script-status reports "error"', async () => {
		const client = new FakeAgentApi()
		client.statuses = [{ state: 'error', lastApplyError: 'SyntaxError: boom' }]
		const { writeFile } = writer()

		await expect(
			installBoardScript(client, bundle, { docName: 'session', writeFile, sleep: async () => {} }),
		).rejects.toThrow(/SyntaxError: boom/)
	})

	it('throws a clear timeout error when it never applies', async () => {
		const client = new FakeAgentApi()
		client.statuses = [{ state: 'pending' }]
		const { writeFile } = writer()
		let now = 0
		const realNow = Date.now
		Date.now = () => now

		try {
			await expect(
				installBoardScript(client, bundle, {
					docName: 'session',
					writeFile,
					timeoutMs: 100,
					pollIntervalMs: 40,
					sleep: async (ms) => {
						now += ms
					},
				}),
			).rejects.toThrow(/did not apply within 100 ms/)
		} finally {
			Date.now = realNow
		}
	})
})
