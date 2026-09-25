import { describe, expect, it } from 'vitest'
import { readBoardScriptBundle } from '../../src/desktop/boardScriptBundle'

describe('readBoardScriptBundle', () => {
	it('reads config.js and main.js from the given directory', async () => {
		const files: Record<string, string> = {
			'/built/config.js': 'export default 1',
			'/built/main.js': 'export default 2',
		}
		const bundle = await readBoardScriptBundle({
			dir: '/built',
			readFile: async (p) => {
				const content = files[p]
				if (content === undefined) throw new Error(`ENOENT: ${p}`)
				return content
			},
		})
		expect(bundle).toEqual({ configJs: 'export default 1', mainJs: 'export default 2' })
	})

	it('reports a clear, actionable error when the bundle is missing', async () => {
		await expect(
			readBoardScriptBundle({
				dir: '/not-built',
				readFile: async () => {
					throw new Error('ENOENT')
				},
			}),
		).rejects.toThrow(/build:board-script/)
	})
})
