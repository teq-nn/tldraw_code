import type { PageBox } from '@tldraw-code/protocol'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
	Box,
	type Editor,
	type TLAnyShapeUtilConstructor,
	type TLComponents,
	type TLShapeId,
	Tldraw,
	useEditor,
	useValue,
} from 'tldraw'
import { hideCollapsedContent } from '../comparison/comparisonFrames'
import { openSnapshot } from '../snapshot/openSnapshot'
import {
	LAYOUT_DEMO_MANIFEST,
	type LayoutDemoManifest,
	type LayoutDemoRun,
	type LayoutDemoStep,
} from './layoutDemoManifest'

/**
 * The layout demo (`?demo`): the layout benchmark's scene, step by step, with
 * every run side by side, so layout flavours can be judged by eye. Each panel
 * is a read-only canvas showing that run's snapshot after the current step,
 * with what the step changed drawn over it. Run `pnpm bench:layout` first.
 *
 * Each step zooms to what it is about, and nodes the step moved glide from
 * their old place to their new one, so a re-layout shows as motion.
 *
 * Keys: ←/→ step, 1–9 jump to a step, R replays the motion, hold Space to
 * see the step before, Z switches between close-up and the whole canvas,
 * H hides the highlights, F fits every panel, Esc leaves a single panel.
 */
export function LayoutDemo({ shapeUtils }: { shapeUtils: TLAnyShapeUtilConstructor[] }) {
	const [manifest, setManifest] = useState<LayoutDemoManifest>()
	const [error, setError] = useState<string>()
	// `?demo&step=4` opens on step 4.
	const [stepIndex, setStepIndex] = useState(
		() => Math.max(1, Number(new URLSearchParams(window.location.search).get('step')) || 1) - 1,
	)
	const [focused, setFocused] = useState<string>()
	const [highlights, setHighlights] = useState(true)
	const [peek, setPeek] = useState(false)
	const [fitRequest, setFitRequest] = useState(0)
	const [replay, setReplay] = useState(0)
	const [overview, setOverview] = useState(false)

	useEffect(() => {
		fetch(LAYOUT_DEMO_MANIFEST)
			.then((response) => {
				if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
				return response.json() as Promise<LayoutDemoManifest>
			})
			.then(setManifest)
			.catch((cause: unknown) =>
				setError(
					`Could not load ${LAYOUT_DEMO_MANIFEST} (${String(cause)}). Run pnpm bench:layout first.`,
				),
			)
	}, [])

	const stepCount = manifest?.steps.length ?? 0
	useEffect(() => {
		const go = (delta: number) =>
			setStepIndex((index) => Math.min(stepCount - 1, Math.max(0, index + delta)))
		const down = (event: KeyboardEvent) => {
			if (event.key === 'ArrowRight') go(1)
			else if (event.key === 'ArrowLeft') go(-1)
			else if (event.key === ' ') {
				event.preventDefault()
				setPeek(true)
			} else if (event.key === 'h' || event.key === 'H') setHighlights((on) => !on)
			else if (event.key === 'f' || event.key === 'F') setFitRequest((n) => n + 1)
			else if (event.key === 'r' || event.key === 'R') setReplay((n) => n + 1)
			else if (event.key === 'z' || event.key === 'Z') setOverview((on) => !on)
			else if (event.key === 'Escape') setFocused(undefined)
			else if (/^[1-9]$/.test(event.key) && Number(event.key) <= stepCount)
				setStepIndex(Number(event.key) - 1)
			else return
			event.stopPropagation()
		}
		const up = (event: KeyboardEvent) => {
			if (event.key === ' ') setPeek(false)
		}
		// Capture, so the panels' editors do not take the keys first.
		window.addEventListener('keydown', down, true)
		window.addEventListener('keyup', up, true)
		return () => {
			window.removeEventListener('keydown', down, true)
			window.removeEventListener('keyup', up, true)
		}
	}, [stepCount])

	if (error) return <div className="layout-demo__message">{error}</div>
	if (!manifest) return <div className="layout-demo__message">Loading the layout demo…</div>

	const step = manifest.steps[stepIndex]
	const shown = focused ? manifest.runs.filter((run) => run.name === focused) : manifest.runs
	const shownIndex = peek ? Math.max(0, stepIndex - 1) : stepIndex

	return (
		<div className="layout-demo">
			<header className="layout-demo__header">
				<div className="layout-demo__steps">
					<button
						type="button"
						onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
						disabled={stepIndex === 0}
					>
						←
					</button>
					{manifest.steps.map((s, index) => (
						<button
							type="button"
							key={s.name}
							data-active={index === stepIndex}
							onClick={() => setStepIndex(index)}
						>
							{index + 1} {s.name}
						</button>
					))}
					<button
						type="button"
						onClick={() => setStepIndex((i) => Math.min(stepCount - 1, i + 1))}
						disabled={stepIndex === stepCount - 1}
					>
						→
					</button>
				</div>
				<p className="layout-demo__description">
					<strong>
						Step {stepIndex + 1}: {step?.name}.
					</strong>{' '}
					{step?.description}
					{peek && <em> Showing the step before (Space held).</em>}
				</p>
				<div className="layout-demo__legend">
					<span data-kind="moved">moved (dashed: where it was)</span>
					<span data-kind="added">added</span>
					<span data-kind="overlap">overlap</span>
					<span data-kind="anchor">anchor lost</span>
					<span data-kind="user">user shape moved</span>
					<span className="layout-demo__keys">
						←/→ step · R replay motion · hold Space: step before · Z close-up / whole canvas · H
						highlights · click a name to enlarge
					</span>
				</div>
			</header>
			<div className="layout-demo__grid" data-count={shown.length}>
				{shown.map((run) => (
					<RunPanel
						key={run.name}
						run={run}
						stepName={manifest.steps[shownIndex]?.name ?? ''}
						stepNames={manifest.steps.map((s) => s.name)}
						highlights={highlights && !peek}
						shapeUtils={shapeUtils}
						fitRequest={fitRequest}
						replay={replay}
						focused={focused === run.name}
						overview={overview}
						onTitleClick={() => setFocused(focused ? undefined : run.name)}
					/>
				))}
			</div>
		</div>
	)
}

/** The run's step of that name, or, when the run has no such step, the latest one before it. */
function stepOf(run: LayoutDemoRun, stepName: string, stepNames: string[]) {
	for (let index = stepNames.indexOf(stepName); index >= 0; index--) {
		const step = run.steps.find((s) => s.name === stepNames[index])
		if (step) return { step, missing: index !== stepNames.indexOf(stepName) }
	}
	return undefined
}

/** How long a moved node takes to glide from its old place to its new one. */
const GLIDE_MS = 900

/**
 * Put the moved nodes back where they were, then animate them to where the
 * step put them. Returns a function that cancels a glide not yet started.
 */
function glide(editor: Editor, moves: LayoutDemoStep['highlights']['moved']): () => void {
	const shapes = moves.flatMap((move) => {
		const shape = editor.getShape(move.shapeId as TLShapeId)
		return shape ? [{ shape, move }] : []
	})
	editor.updateShapes(
		shapes.map(({ shape, move }) => ({
			id: shape.id,
			type: shape.type,
			x: move.from.x,
			y: move.from.y,
		})),
	)
	const timer = setTimeout(() => {
		editor.animateShapes(
			shapes.map(({ shape, move }) => ({
				id: shape.id,
				type: shape.type,
				x: move.to.x,
				y: move.to.y,
			})),
			{ animation: { duration: GLIDE_MS } },
		)
	}, 300)
	return () => clearTimeout(timer)
}

/** Zoom to a step's area: what it shows and what the step before showed. */
function fitTo(editor: Editor, { x, y, w, h }: PageBox) {
	editor.zoomToBounds(new Box(x, y, w, h), { inset: 24, immediate: true })
}

const HighlightContext = createContext<LayoutDemoStep['highlights'] | undefined>(undefined)

const snapshots = new Map<string, Promise<string>>()
function fetchSnapshot(url: string): Promise<string> {
	let text = snapshots.get(url)
	if (!text) {
		text = fetch(url).then((response) => {
			if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
			return response.text()
		})
		snapshots.set(url, text)
	}
	return text
}

function RunPanel({
	run,
	stepName,
	stepNames,
	highlights,
	shapeUtils,
	fitRequest,
	replay,
	focused,
	overview,
	onTitleClick,
}: {
	run: LayoutDemoRun
	stepName: string
	stepNames: string[]
	highlights: boolean
	shapeUtils: TLAnyShapeUtilConstructor[]
	fitRequest: number
	replay: number
	focused: boolean
	overview: boolean
	onTitleClick(): void
}) {
	const [editor, setEditor] = useState<Editor>()
	const [loadError, setLoadError] = useState<string>()
	const found = stepOf(run, stepName, stepNames)
	const url = found ? `bench/demo/${found.step.snapshot}` : undefined
	const bounds = found && (overview ? found.step.overview : found.step.closeUp)
	// Moved nodes glide from where they were, so a re-layout shows as motion; not while peeking back.
	const moves = highlights && found && !found.missing ? found.step.highlights.moved : undefined

	// biome-ignore lint/correctness/useExhaustiveDependencies: replay reloads the step to run its motion again
	useEffect(() => {
		if (!editor || !url) return
		let current = true
		let stopGlide: (() => void) | undefined
		fetchSnapshot(url)
			.then((json) => {
				if (!current) return
				openSnapshot(editor, json, { zoomToFit: false })
				editor.updateInstanceState({ isReadonly: true })
				if (bounds) fitTo(editor, bounds)
				if (moves) stopGlide = glide(editor, moves)
				setLoadError(undefined)
			})
			.catch((cause: unknown) => current && setLoadError(`Could not open ${url}: ${String(cause)}`))
		return () => {
			current = false
			stopGlide?.()
		}
	}, [editor, url, bounds, moves, replay])

	// biome-ignore lint/correctness/useExhaustiveDependencies: refit on request and when the panel is enlarged
	useEffect(() => {
		if (!editor || !bounds) return
		// Let the editor see its new size first when the panel was enlarged.
		const timer = setTimeout(() => fitTo(editor, bounds), 50)
		return () => clearTimeout(timer)
	}, [editor, bounds, fitRequest, focused])

	const components = useMemo<TLComponents>(() => ({ InFrontOfTheCanvas: Highlights }), [])

	return (
		<section className="layout-demo__panel">
			<div className="layout-demo__panel-header">
				<button type="button" className="layout-demo__title" onClick={onTitleClick}>
					{run.name}
				</button>
				<span className="layout-demo__summary">{run.summary}</span>
			</div>
			<div className="layout-demo__stats">
				{found?.missing && <span className="layout-demo__stat">no such step in this run</span>}
				{found?.step.stats.map((stat) => (
					<span key={stat.label} className="layout-demo__stat" data-bad={stat.bad}>
						{stat.label} <b>{stat.value}</b>
					</span>
				))}
			</div>
			<div className="layout-demo__canvas">
				<HighlightContext.Provider
					value={highlights && found && !found.missing ? found.step.highlights : undefined}
				>
					<Tldraw
						hideUi
						shapeUtils={shapeUtils}
						components={components}
						getShapeVisibility={hideCollapsedContent}
						onMount={setEditor}
					/>
				</HighlightContext.Provider>
				{loadError && <div className="layout-demo__message">{loadError}</div>}
			</div>
			<details className="layout-demo__totals">
				<summary>Whole run</summary>
				{run.totals.map((total) => (
					<span key={total.label} className="layout-demo__stat">
						{total.label} <b>{total.value}</b>
					</span>
				))}
			</details>
		</section>
	)
}

/** What the step changed, drawn over the canvas's shapes, following its camera. */
function Highlights() {
	const highlights = useContext(HighlightContext)
	const editor = useEditor()
	const camera = useValue('camera', () => editor.getCamera(), [editor])
	if (!highlights) return null
	const rect = (box: PageBox, className: string, key: string, title: string) => (
		<rect
			key={key}
			className={className}
			x={box.x}
			y={box.y}
			width={box.w}
			height={box.h}
			vectorEffect="non-scaling-stroke"
		>
			<title>{title}</title>
		</rect>
	)
	return (
		<svg className="layout-demo__highlights" aria-hidden="true">
			<g transform={`scale(${camera.z}) translate(${camera.x} ${camera.y})`}>
				{highlights.moved.map((move) => (
					<g key={`moved-${move.label}`}>
						{rect(move.from, 'layout-demo__ghost', 'from', `${move.label} was here`)}
						{rect(move.to, 'layout-demo__moved', 'to', `${move.label} moved`)}
						<line
							className="layout-demo__move-line"
							x1={move.from.x + move.from.w / 2}
							y1={move.from.y + move.from.h / 2}
							x2={move.to.x + move.to.w / 2}
							y2={move.to.y + move.to.h / 2}
							vectorEffect="non-scaling-stroke"
						/>
					</g>
				))}
				{highlights.added.map((box, index) =>
					rect(box, 'layout-demo__added', `added-${index}`, 'added'),
				)}
				{highlights.anchorsLost.map((lost) =>
					rect(
						lost.box,
						'layout-demo__anchor',
						`anchor-${lost.label}`,
						`${lost.label} lost its anchor`,
					),
				)}
				{highlights.userMoved.map((moved) =>
					rect(
						moved.box,
						'layout-demo__user',
						`user-${moved.label}`,
						`${moved.label} moved by Claude`,
					),
				)}
				{highlights.overlaps.map((overlap) =>
					rect(overlap.box, 'layout-demo__overlap', `overlap-${overlap.label}`, overlap.label),
				)}
			</g>
		</svg>
	)
}
