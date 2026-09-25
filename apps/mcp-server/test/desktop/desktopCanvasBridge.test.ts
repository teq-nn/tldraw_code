import { makeOkResult } from '@tldraw-code/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DesktopCanvasBridge } from '../../src/desktop/desktopCanvasBridge'
import { DesktopReadiness } from '../../src/desktop/desktopReadiness'
import { FakeCanvas } from '../fakeCanvas'
import { FakeAgentApi } from './installBoardScript'

const bundle = { configJs: 'export default () => {}', mainJs: 'export default () => {}' }

describe('DesktopCanvasBridge', () => {
	let bridge: DesktopCanvasBridge
	let client: FakeAgentApi
	const canvases: FakeCanvas[] = []

	beforeEach(() => {
		client = new FakeAgentApi()
	})

	afterEach(async () => {
		await Promise.all(canvases.splice(0).map((c) => c.close()))
		await bridge.stop()
	})

	function makeBridge() {
		const readiness = new DesktopReadiness({
			client,
			docName: 'tldraw-code session',
			readBundle: async () => bundle,
			readFile: async () => bundle.mainJs, // pretend it's already installed and matching
			writeFile: async () => {},
			sleep: async () => {},
			connectTimeoutMs: 200,
			connectPollIntervalMs: 10,
		})
		return { readiness }
	}

	it('ensures readiness before sending a command, and saves after a write command', async () => {
		const { readiness } = makeBridge()
		bridge = new DesktopCanvasBridge({ port: 0, readiness })
		const port = await bridge.start()
		const canvas = await FakeCanvas.connect(port)
		canvases.push(canvas)
		for (let i = 0; i < 100 && !bridge.isConnected(); i++)
			await new Promise((r) => setTimeout(r, 10))
		canvas.respondWith((command) => makeOkResult(command.id, { shapeId: 'shape:abc' }))

		await bridge.request('smoke.create_shape', { text: 'hi' })

		expect(client.writes).toEqual([
			{ docId: 'doc:tldraw-code session', code: 'await helpers.saveDoc()' },
		])
	})

	it('does not save after a read-only command', async () => {
		const { readiness } = makeBridge()
		bridge = new DesktopCanvasBridge({ port: 0, readiness })
		const port = await bridge.start()
		const canvas = await FakeCanvas.connect(port)
		canvases.push(canvas)
		for (let i = 0; i < 100 && !bridge.isConnected(); i++)
			await new Promise((r) => setTimeout(r, 10))
		canvas.respondWith((command) =>
			makeOkResult(command.id, {
				region: null,
				shapes: [],
				omitted: 0,
				screenshot: null,
			}),
		)

		await bridge.request('canvas.read', { region: 'all', screenshot: false })

		expect(client.writes).toEqual([])
	})

	it('waits for the canvas to connect before the command is sent, if it is not connected yet', async () => {
		const { readiness } = makeBridge()
		bridge = new DesktopCanvasBridge({ port: 0, readiness })
		const port = await bridge.start()

		const requestPromise = bridge.request('smoke.create_shape', { text: 'hi' })
		await new Promise((r) => setTimeout(r, 20))
		const canvas = await FakeCanvas.connect(port)
		canvases.push(canvas)
		canvas.respondWith((command) => makeOkResult(command.id, { shapeId: 'shape:abc' }))

		const result = await requestPromise
		expect(result.shapeId).toBe('shape:abc')
	})
})
