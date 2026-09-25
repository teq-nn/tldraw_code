/**
 * The layout benchmark (issue #25): replays one representative session
 * against the canvas's real command handlers in a headless editor, once per
 * layout flavour, prints each flavour's scorecard and writes its final canvas
 * as a snapshot to open on the canvas.
 *
 *   pnpm bench:layout              # every flavour
 *   pnpm bench:layout baseline     # only the named ones
 *
 * Flavours are registered in `src/bridge/layoutFlavours.ts`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

/** Where snapshots go: the canvas serves this folder, so `?snapshot=bench/<flavour>.tldr` opens one. */
const SNAPSHOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../public/bench')
const CANVAS_URL = 'http://127.0.0.1:5173'

// tldraw skips measuring text it cannot measure without a browser only when it knows it is under test.
process.env.NODE_ENV = 'test'
// The editor needs a DOM (it measures text and reads its container); give it jsdom's, as the tests do.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
	pretendToBeVisual: true,
	url: CANVAS_URL,
})
const globals = globalThis as Record<string, unknown>
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globals) continue
	globals[key] = (dom.window as unknown as Record<string, unknown>)[key]
}

// Imported after the DOM exists: tldraw looks for it when it loads.
const { LAYOUT_FLAVOURS } = await import('../src/bridge/layoutFlavours')
const { runScene } = await import('./runScene')
const { SCENE } = await import('./scene')
const { formatComparison, formatScorecard, scoreRun } = await import('./scorecard')

const wanted = process.argv.slice(2)
const unknown = wanted.filter((name) => !LAYOUT_FLAVOURS.some((flavour) => flavour.name === name))
if (unknown.length > 0) {
	const known = LAYOUT_FLAVOURS.map((flavour) => flavour.name).join(', ')
	console.error(`Unknown layout flavour: ${unknown.join(', ')}. Known: ${known}.`)
	process.exit(1)
}
const flavours = LAYOUT_FLAVOURS.filter(
	(flavour) => wanted.length === 0 || wanted.includes(flavour.name),
)

mkdirSync(SNAPSHOT_DIR, { recursive: true })
const cards = []
for (const flavour of flavours) {
	const run = await runScene(flavour, SCENE)
	const card = scoreRun(run, SCENE)
	cards.push(card)
	const file = join(SNAPSHOT_DIR, `${flavour.name}.tldr`)
	writeFileSync(file, run.snapshot)
	console.log(`\n=== Layout flavour "${flavour.name}": ${flavour.summary}\n`)
	console.log(formatScorecard(card))
	console.log(`\nFinal canvas: ${relative(process.cwd(), file)}`)
	console.log(`  open with pnpm dev, then ${CANVAS_URL}/?snapshot=bench/${flavour.name}.tldr`)
}
if (cards.length > 1) {
	console.log('\n=== All flavours (aggregates)\n')
	console.log(formatComparison(cards))
}
// jsdom's animation frames and tldraw's timers would keep the process alive.
process.exit(0)
