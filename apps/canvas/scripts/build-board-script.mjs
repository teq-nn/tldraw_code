#!/usr/bin/env node
// Builds the canvas as a tldraw offline board script (ticket #16): the same
// shapes, command handlers and bridge client as the Vite app, bundled without
// the Vite shell so `CANVAS_BACKEND=desktop` can install them as `config.js`
// and `main.js` via tldraw offline's Agent API.
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
// Not apps/canvas/dist/board-script: `vite build` empties `dist/` on every
// run (`emptyOutDir`, the default), which would silently delete this bundle
// whenever the Vite app is rebuilt after it. A sibling directory keeps the
// two builds independent, matching the ticket: "ohne Flag funktioniert die
// Vite-Canvas unverändert" — including its own build.
const outdir = path.join(root, 'dist-board-script')

// Baked into main.js as a global constant instead of an ordinary CSS import:
// esbuild's own CSS handling would try to emit a separate .css asset with
// nowhere on tldraw offline's page to link it from, and the file opens with
// `@import url("tldraw/tldraw.css")`, which only makes sense in the Vite
// app — the offline app already loads the SDK's base styles for its own
// editor (`injectBoardStyles` strips the import either way, defensively).
const boardCss = readFileSync(path.join(root, 'src', 'index.css'), 'utf8')

mkdirSync(outdir, { recursive: true })

await build({
	entryPoints: {
		config: path.join(root, 'src', 'board-script', 'config.entry.ts'),
		main: path.join(root, 'src', 'board-script', 'main.entry.ts'),
	},
	outdir,
	bundle: true,
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	jsx: 'automatic',
	jsxImportSource: 'react',
	// tldraw offline resolves these bare specifiers through its own import map
	// to the app's single SDK/React instance, so they must not be bundled in.
	// Everything else here (dagre, @tldraw-code/protocol) is not importable
	// there and has to be bundled (docs/adr — canvas as a board script).
	external: ['tldraw', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
	define: {
		__BOARD_CSS__: JSON.stringify(boardCss),
		// Board-script equivalent of the Vite canvas's VITE_CANVAS_BRIDGE_URL:
		// both are build-time overrides of the bridge port/URL (see main.entry.ts).
		__BOARD_BRIDGE_URL__: JSON.stringify(process.env.CANVAS_BOARD_SCRIPT_BRIDGE_URL ?? ''),
	},
	logLevel: 'info',
})
