/**
 * The layout benchmark (issue #25): replays one representative session
 * against the canvas's real command handlers in a headless editor, once per
 * layout flavour, prints each flavour's scorecard and writes its final canvas
 * as a snapshot to open on the canvas.
 *
 *   pnpm bench:layout              # every flavour
 *   pnpm bench:layout baseline     # only the named ones
 *
 * Flavours are registered in `src/bridge/layoutFlavours.ts`. Next to them
 * runs `user-owned+tidy`: F2 on the scene with a tidy after step 7 (#29).
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
const { SCENE, SCENE_WITH_TIDY } = await import('./scene')
const { formatComparison, formatScorecard, scoreRun } = await import('./scorecard')

/** Every run: each flavour on the scene, and F2 on the scene with a tidy (#29). */
const RUNS = [
	...LAYOUT_FLAVOURS.map((flavour) => ({
		name: flavour.name,
		flavour,
		scene: SCENE,
		summary: flavour.summary,
	})),
	...LAYOUT_FLAVOURS.filter((flavour) => flavour.name === 'user-owned').map((flavour) => ({
		name: `${flavour.name}+tidy`,
		flavour,
		scene: SCENE_WITH_TIDY,
		summary: `${flavour.summary} With a tidy after step 7.`,
	})),
]

const wanted = process.argv.slice(2)
const unknown = wanted.filter((name) => !RUNS.some((run) => run.name === name))
if (unknown.length > 0) {
	const known = RUNS.map((run) => run.name).join(', ')
	console.error(`Unknown layout flavour: ${unknown.join(', ')}. Known: ${known}.`)
	process.exit(1)
}
const runs = RUNS.filter((run) => wanted.length === 0 || wanted.includes(run.name))

mkdirSync(SNAPSHOT_DIR, { recursive: true })
const cards = []
for (const { name, flavour, scene, summary } of runs) {
	const run = await runScene(flavour, scene, name)
	const card = scoreRun(run, scene)
	cards.push(card)
	const file = join(SNAPSHOT_DIR, `${name}.tldr`)
	writeFileSync(file, run.snapshot)
	console.log(`\n=== Layout flavour "${name}": ${summary}\n`)
	console.log(formatScorecard(card))
	console.log(`\nFinal canvas: ${relative(process.cwd(), file)}`)
	// A "+" in a query string reads as a space.
	console.log(
		`  open with pnpm dev, then ${CANVAS_URL}/?snapshot=bench/${encodeURIComponent(name)}.tldr`,
	)
}
if (cards.length > 1) {
	console.log('\n=== All flavours (aggregates)\n')
	console.log(formatComparison(cards))
}
// jsdom's animation frames and tldraw's timers would keep the process alive.
process.exit(0)
