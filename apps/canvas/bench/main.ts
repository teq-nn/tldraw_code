/**
 * The layout benchmark (issue #25): replays one representative session
 * against the canvas's real command handlers in a headless editor, once per
 * run, prints each run's scorecard and writes its final canvas as a snapshot
 * to open on the canvas.
 *
 *   pnpm bench:layout                # every run
 *   pnpm bench:layout user-owned     # only the named ones
 *
 * It also writes every run's canvas after every step for the layout demo
 * (`?demo` on the canvas), which walks through the runs side by side.
 *
 * The runs are listed in {@link RUNS}: the scene as it is, and the scene with
 * a tidy after step 7 (#29).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

/** Where snapshots go: the canvas serves this folder, so `?snapshot=bench/<run>.tldr` opens one. */
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
const { runScene } = await import('./runScene')
const { SCENE, SCENE_WITH_TIDY } = await import('./scene')
const { formatComparison, formatScorecard, scoreRun } = await import('./scorecard')
const { writeLayoutDemo } = await import('./demo')

const USER_OWNED =
	'Placed nodes never move, dragged ones included; new nodes go into free space beside their blockers; removed ones leave their gap (ADR 0032).'

/** Every run: the scene, and the scene with a tidy (#29). */
const RUNS = [
	{ name: 'user-owned', scene: SCENE, summary: USER_OWNED },
	{
		name: 'user-owned+tidy',
		scene: SCENE_WITH_TIDY,
		summary: `${USER_OWNED} With a tidy after step 7.`,
	},
]

const wanted = process.argv.slice(2)
const unknown = wanted.filter((name) => !RUNS.some((run) => run.name === name))
if (unknown.length > 0) {
	const known = RUNS.map((run) => run.name).join(', ')
	console.error(`Unknown run: ${unknown.join(', ')}. Known: ${known}.`)
	process.exit(1)
}
const runs = RUNS.filter((run) => wanted.length === 0 || wanted.includes(run.name))

mkdirSync(SNAPSHOT_DIR, { recursive: true })
const cards = []
const demoRuns = []
for (const { name, scene, summary } of runs) {
	const run = await runScene(scene, name)
	const card = scoreRun(run, scene)
	cards.push(card)
	demoRuns.push({ run, scene, card, summary })
	const file = join(SNAPSHOT_DIR, `${name}.tldr`)
	writeFileSync(file, run.snapshot)
	console.log(`\n=== Run "${name}": ${summary}\n`)
	console.log(formatScorecard(card))
	console.log(`\nFinal canvas: ${relative(process.cwd(), file)}`)
	// A "+" in a query string reads as a space.
	console.log(
		`  open with pnpm dev, then ${CANVAS_URL}/?snapshot=bench/${encodeURIComponent(name)}.tldr`,
	)
}
if (cards.length > 1) {
	console.log('\n=== All runs (aggregates)\n')
	console.log(formatComparison(cards))
}
// Overwritten in place, not deleted first: a running dev server stops serving a public folder that is removed and recreated.
const demoDir = join(SNAPSHOT_DIR, 'demo')
mkdirSync(demoDir, { recursive: true })
writeLayoutDemo(demoDir, demoRuns)
console.log(`\nStep-by-step demo of every run: pnpm dev, then ${CANVAS_URL}/?demo`)
// jsdom's animation frames and tldraw's timers would keep the process alive.
process.exit(0)
