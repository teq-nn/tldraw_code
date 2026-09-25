import { readFile as readFileFromDisk } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BoardScriptBundle } from './installBoardScript'

/**
 * `apps/canvas/dist-board-script`, computed from this file's own location so
 * it resolves the same whether running from `src` (via `tsx`) or `dist`
 * (built): both sit three levels under `apps/`. Not `apps/canvas/dist/…`:
 * `vite build` empties `dist/` on every run, which would delete this bundle
 * (`scripts/build-board-script.mjs`). Overridable for a build laid out
 * elsewhere.
 */
export function defaultBoardScriptDir(): string {
	if (process.env.CANVAS_BOARD_SCRIPT_DIR) return process.env.CANVAS_BOARD_SCRIPT_DIR
	const here = path.dirname(fileURLToPath(import.meta.url))
	return path.resolve(here, '../../../canvas/dist-board-script')
}

export interface ReadBoardScriptBundleOptions {
	/** Defaults to {@link defaultBoardScriptDir}. */
	dir?: string
	/** Injectable for tests; defaults to reading the real files. */
	readFile?: (path: string) => Promise<string>
}

/**
 * Read the board script bundle built by
 * `pnpm --filter @tldraw-code/canvas build:board-script` (ticket #16): the
 * same shapes and bridge client as the Vite canvas, bundled without the Vite
 * shell. Throws a clear, actionable error if it has not been built.
 */
export async function readBoardScriptBundle(
	options: ReadBoardScriptBundleOptions = {},
): Promise<BoardScriptBundle> {
	const dir = options.dir ?? defaultBoardScriptDir()
	const readFile = options.readFile ?? ((p: string) => readFileFromDisk(p, 'utf8'))
	try {
		const [configJs, mainJs] = await Promise.all([
			readFile(path.join(dir, 'config.js')),
			readFile(path.join(dir, 'main.js')),
		])
		return { configJs, mainJs }
	} catch (error) {
		throw new Error(
			`the canvas board script is not built (looked in ${dir}): run ` +
				`"pnpm --filter @tldraw-code/canvas build:board-script" first ` +
				`(${error instanceof Error ? error.message : String(error)})`,
		)
	}
}
