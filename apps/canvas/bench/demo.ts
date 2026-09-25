import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CanvasShape, PageBox } from '@tldraw-code/protocol'
import type {
	LayoutDemoManifest,
	LayoutDemoRun,
	LayoutDemoStep,
} from '../src/demo/layoutDemoManifest'
import { displacement, union } from './metrics'
import type { SceneRun, StepRecord } from './runScene'
import type { Scene } from './scene'
import { decisionNodes, labelOf, type Scorecard, type StepScore, topLevel } from './scorecard'

/** Offsets up to this many page units do not count as a move. */
const STILL = 1

export interface DemoRun {
	run: SceneRun
	scene: Scene
	card: Scorecard
	summary: string
}

/**
 * Write what the layout demo (`?demo`) walks through into `dir`: every run's
 * canvas after every step, and a manifest with each step's numbers and what to
 * highlight (nodes moved or added, overlaps, lost anchors, moved user shapes).
 */
export function writeLayoutDemo(dir: string, runs: DemoRun[]): void {
	const longest = runs.reduce((a, b) => (b.scene.steps.length > a.scene.steps.length ? b : a))
	const manifest: LayoutDemoManifest = {
		steps: longest.scene.steps.map(({ name, description }) => ({ name, description })),
		runs: runs.map((demoRun) => demoRunOf(dir, demoRun)),
	}
	writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
}

function demoRunOf(dir: string, { run, scene, card, summary }: DemoRun): LayoutDemoRun {
	const folder = run.flavour.replace(/[^a-z0-9-]+/gi, '_')
	mkdirSync(join(dir, folder), { recursive: true })
	const reference = run.steps[scene.annotations.anchorsFrom - 1]
	const steps = run.steps.map((step, index): LayoutDemoStep => {
		const snapshot = `${folder}/${index + 1}-${step.name}.tldr`
		writeFileSync(join(dir, snapshot), step.snapshot)
		const score = card.steps[index] as StepScore
		const tracked = index + 1 >= scene.annotations.anchorsFrom ? reference : undefined
		return demoStep(step, run.steps[index - 1], tracked, scene.annotations.ids, score, snapshot)
	})
	return {
		name: run.flavour,
		summary,
		steps,
		totals: totalsOf(card),
	}
}

function demoStep(
	step: StepRecord,
	previous: StepRecord | undefined,
	reference: StepRecord | undefined,
	annotations: readonly string[],
	score: StepScore,
	snapshot: string,
): LayoutDemoStep {
	const nodes = decisionNodes(step.shapes)
	const before = previous ? decisionNodes(previous.shapes) : new Map<string, PageBox>()
	const moved = [...nodes].flatMap(([id, to]) => {
		const from = before.get(id)
		const still = !from || (Math.abs(from.x - to.x) <= STILL && Math.abs(from.y - to.y) <= STILL)
		return still ? [] : [{ label: id, from, to }]
	})
	const added = previous ? [...nodes].filter(([id]) => !before.has(id)).map(([, box]) => box) : []
	const byLabel = new Map(step.shapes.map((shape) => [labelOf(shape), shape.bounds]))
	const byId = new Map(step.shapes.map((shape) => [shape.id, shape]))
	const overlaps = [...score.overlaps.claudeClaude, ...score.overlaps.claudeUser].flatMap(
		([a, b]) => {
			const box = intersection(byLabel.get(a), byLabel.get(b))
			return box ? [{ label: `${a} × ${b}`, box }] : []
		},
	)
	const anchorsLost = reference
		? annotations.flatMap((id) => {
				const now = byId.get(id)
				const was = reference.shapes.find((shape) => shape.id === id)
				if (!now || !was || now.anchor?.shapeId === was.anchor?.shapeId) return []
				return [{ label: nameOf(now), box: now.bounds }]
			})
		: []
	const userMoved = step.userShapesMoved.flatMap((id) => {
		const shape = byId.get(id)
		return shape ? [{ label: nameOf(shape), box: shape.bounds }] : []
	})
	const moves = previous ? displacement(before, nodes) : undefined
	const shown = [...topLevel(step.shapes), ...topLevel(previous?.shapes ?? [])]
	return {
		name: step.name,
		snapshot,
		bounds: union(shown.map((shape) => shape.bounds)) ?? { x: 0, y: 0, w: 1, h: 1 },
		stats: [
			{ label: 'Nodes moved', value: String(moved.length), bad: moved.length > 0 },
			{ label: 'Mean move', value: moves ? moves.mean.toFixed(0) : '-' },
			{
				label: 'Anchors kept',
				value: score.anchorsKept ? `${score.anchorsKept.kept}/${score.anchorsKept.total}` : '-',
				bad: !!score.anchorsKept && score.anchorsKept.kept < score.anchorsKept.total,
			},
			{ label: 'User shapes moved', value: String(userMoved.length), bad: userMoved.length > 0 },
			{ label: 'Overlaps', value: String(overlaps.length), bad: overlaps.length > 0 },
			{
				label: 'Crossings (1 = none)',
				value: score.graph ? score.graph.crossings.toFixed(2) : '-',
			},
		],
		highlights: { moved, added, overlaps, anchorsLost, userMoved },
	}
}

function totalsOf(card: Scorecard): LayoutDemoRun['totals'] {
	const { aggregate } = card
	return [
		{ label: 'Crossings (1 = none)', value: aggregate.graph.crossings.toFixed(2) },
		{ label: 'Mean displacement', value: aggregate.stability.meanDisplacement.toFixed(0) },
		{ label: 'Order kept', value: aggregate.stability.orthogonalOrder.toFixed(2) },
		{
			label: 'Anchors kept',
			value: aggregate.anchorsKept
				? `${aggregate.anchorsKept.kept}/${aggregate.anchorsKept.total}`
				: '-',
		},
		{ label: 'User shapes moved', value: String(aggregate.userShapesMoved) },
		{
			label: 'Overlaps (Claude/Claude, Claude/user)',
			value: `${aggregate.claudeClaudeOverlaps}, ${aggregate.claudeUserOverlaps}`,
		},
		{
			label: 'Footprint',
			value: `${card.footprint.w.toFixed(0)} × ${card.footprint.h.toFixed(0)}`,
		},
	]
}

function nameOf(shape: CanvasShape): string {
	return shape.text ? `"${shape.text}"` : shape.type
}

function intersection(a: PageBox | undefined, b: PageBox | undefined): PageBox | undefined {
	if (!a || !b) return undefined
	const x = Math.max(a.x, b.x)
	const y = Math.max(a.y, b.y)
	const w = Math.min(a.x + a.w, b.x + b.w) - x
	const h = Math.min(a.y + a.h, b.y + b.h) - y
	return w > 0 && h > 0 ? { x, y, w, h } : undefined
}
