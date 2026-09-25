import { describe, expect, it } from 'vitest'
import { CanvasBridgeError } from '../../src/bridge'
import { DesktopReadiness } from '../../src/desktop/desktopReadiness'
import { FakeAgentApi } from './installBoardScript'

const bundle = {
	configJs: 'export default () => {} // v1',
	mainJs: 'export default () => {} // v1',
}
const bundleV2 = {
	configJs: 'export default () => {} // v2',
	mainJs: 'export default () => {} // v2',
}

function harness(overrides: { bundle?: () => Promise<typeof bundle> } = {}) {
	const client = new FakeAgentApi()
	const installed = new Map<string, string>()
	const readFile = async (path: string) => {
		const content = installed.get(path)
		if (content === undefined) throw new Error(`ENOENT: ${path}`)
		return content
	}
	const writeFile = async (path: string, content: string) => {
		installed.set(path, content)
	}
	const logs: string[] = []
	const readiness = new DesktopReadiness({
		client,
		docName: 'tldraw-code session',
		readBundle: overrides.bundle ?? (async () => bundle),
		readFile,
		writeFile,
		sleep: async () => {},
		connectPollIntervalMs: 0,
		connectTimeoutMs: 50,
		log: (message) => logs.push(message),
	})
	return { client, installed, readiness, logs }
}

describe('DesktopReadiness', () => {
	it('creates the session doc, installs the bundle, and waits for the canvas to connect', async () => {
		const { client, installed, readiness } = harness()
		let connected = false
		// The install "connects" the board script after it applies, like a real reconnect.
		client.exec = async (_docId, code) => {
			if (code === 'await helpers.saveDoc()') connected = true
			return undefined as never
		}

		await readiness.ensureReady(() => connected)

		expect(client.created).toEqual([{ name: 'tldraw-code session' }])
		expect(installed.get('/fake/doc:tldraw-code session/script/main.js')).toBe(bundle.mainJs)
		expect(installed.get('/fake/doc:tldraw-code session/script/config.js')).toBe(bundle.configJs)
	})

	it('reuses the cached doc/workspace and skips the Agent API when nothing changed', async () => {
		const { client, readiness } = harness()
		await readiness.ensureReady(() => true)
		const writesAfterFirstInstall = client.writes.length
		const scriptWorkspaceCallsAfterFirst = client.scriptWorkspaceCalls.length
		const createdAfterFirst = client.created.length

		await readiness.ensureReady(() => true)

		// No new write (save) happened because the installed files already matched the bundle,
		// and the cached doc/workspace was reused instead of asking the Agent API again.
		expect(client.writes.length).toBe(writesAfterFirstInstall)
		expect(client.scriptWorkspaceCalls.length).toBe(scriptWorkspaceCallsAfterFirst)
		expect(client.created.length).toBe(createdAfterFirst)
	})

	it('reinstalls when the built bundle changed since the last install, even while connected', async () => {
		let current = bundle
		const { client, installed, readiness } = harness({ bundle: async () => current })
		await readiness.ensureReady(() => true)
		const mainPath = '/fake/doc:tldraw-code session/script/main.js'
		expect(installed.get(mainPath)).toBe(bundle.mainJs)

		current = bundleV2
		await readiness.ensureReady(() => true)

		expect(installed.get(mainPath)).toBe(bundleV2.mainJs)
		expect(client.writes.filter((w) => w.code === 'await helpers.saveDoc()')).toHaveLength(2)
	})

	it('waits for the bridge to (re)connect after installing, and succeeds once it does', async () => {
		const { readiness } = harness()
		let connected = false
		setTimeout(() => {
			connected = true
		}, 0)
		// connectPollIntervalMs is 0 in the harness, so this resolves on the next poll tick.
		await expect(readiness.ensureReady(() => connected)).resolves.toBeUndefined()
	})

	it('throws a clear, actionable error when the canvas never connects', async () => {
		const { readiness } = harness()

		await expect(readiness.ensureReady(() => false)).rejects.toThrow(CanvasBridgeError)
		await expect(readiness.ensureReady(() => false)).rejects.toThrow(/has not connected/)
	})

	it('throws a clear error naming the document when tldraw offline is not reachable', async () => {
		const client = new FakeAgentApi()
		client.search = async () => {
			throw new Error('ECONNREFUSED')
		}
		const readiness = new DesktopReadiness({
			client,
			docName: 'tldraw-code session',
			readBundle: async () => bundle,
			readFile: async () => {
				throw new Error('ENOENT')
			},
			writeFile: async () => {},
			sleep: async () => {},
			connectPollIntervalMs: 0,
			connectTimeoutMs: 50,
		})

		await expect(readiness.ensureReady(() => false)).rejects.toThrow(CanvasBridgeError)
		await expect(readiness.ensureReady(() => false)).rejects.toThrow(/tldraw-code session/)
	})

	it('ensureInstalled() resolves the doc once, up front, and a later ensureReady() reuses it', async () => {
		const { client, readiness } = harness()

		const installed = await readiness.ensureInstalled()

		expect(installed).toEqual({
			docId: 'doc:tldraw-code session',
			docName: 'tldraw-code session',
			filePath: '/fake/tldraw-code session.tldraw',
		})
		const scriptWorkspaceCallsAfterInstall = client.scriptWorkspaceCalls.length
		const createdAfterInstall = client.created.length

		await readiness.ensureReady(() => true)

		expect(client.scriptWorkspaceCalls.length).toBe(scriptWorkspaceCallsAfterInstall)
		expect(client.created.length).toBe(createdAfterInstall)
	})

	it('save() sends helpers.saveDoc() for the resolved session doc, and is a no-op before one exists', async () => {
		const { client, readiness } = harness()

		await readiness.save()
		expect(client.writes).toEqual([])

		await readiness.ensureReady(() => true)
		client.writes.length = 0

		await readiness.save()
		expect(client.writes).toEqual([
			{ docId: 'doc:tldraw-code session', code: 'await helpers.saveDoc()' },
		])
	})
})
