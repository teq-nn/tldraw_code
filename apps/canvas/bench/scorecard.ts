import type { CanvasShape, PageBox } from '@tldraw-code/protocol'
import {
	backwardEdges,
	blockAspect,
	boxGap,
	displacement,
	type Edge,
	edgeLengthCv,
	type Labelled,
	nearestNeighbourPreserved,
	normalisedCrossings,
	orthogonalOrderPreserved,
	overlappingPairs,
	union,
} from './metrics'
import type { SceneRun, StepRecord } from './runScene'
import type { Scene } from './scene'

/**
 * The layout benchmark's scorecard (issue #25): the metrics of every step of
 * one flavour's run of the scene, and their aggregate.
 */

export interface GraphScore {
	/** 1 − crossings / possible crossings: 1 is none. */
	crossings: number
	backwardEdges: number
	edgeLengthCv: number
	/** |ln(w/h)| of the graph's block. */
	aspect: number
}

export interface StepScore {
	name: string
	graph?: GraphScore
	/** Ids of the user shapes one of Claude's commands moved: must be none. */
	userShapesMoved: string[]
	/** Tracked annotations still anchored where they were when the user placed them. */
	anchorsKept?: { kept: number; total: number }
	/** Pairs of Claude's shapes whose bounds intersect, and Claude's shapes over the user's. */
	overlaps: { claudeClaude: [string, string][]; claudeUser: [string, string][] }
	/** Gap between the step's new content and what it is about. */
	focusDistance?: number
	/** Least share of a command's new or moved content in the viewport after it. */
	viewportFit?: number
	zoom: number
}

export interface StabilityScore {
	from: number
	to: number
	meanDisplacement: number
	maxDisplacement: number
	orthogonalOrder: number
	nearestNeighbour: number
}

export interface Scorecard {
	flavour: string
	steps: StepScore[]
	stability: StabilityScore[]
	/** Page bounds after the last step. */
	footprint: { w: number; h: number }
	aggregate: {
		graph: GraphScore
		userShapesMoved: number
		anchorsKept?: StepScore['anchorsKept']
		claudeClaudeOverlaps: number
		claudeUserOverlaps: number
		focusDistance?: number
		viewportFit?: number
		zoom: number
		stability: Omit<StabilityScore, 'from' | 'to'>
	}
}

export function scoreRun(run: SceneRun, scene: Scene): Scorecard {
	const reference = run.steps[scene.annotations.anchorsFrom - 1]
	const steps = run.steps.map((step, index) =>
		scoreStep(step, index + 1 >= scene.annotations.anchorsFrom ? reference : undefined, scene),
	)
	const stability = scene.stabilitySpans.map(([from, to]) => {
		const before = decisionNodes(run.steps[from - 1]?.shapes ?? [])
		const after = decisionNodes(run.steps[to - 1]?.shapes ?? [])
		const moved = displacement(before, after)
		return {
			from,
			to,
			meanDisplacement: moved.mean,
			maxDisplacement: moved.max,
			orthogonalOrder: orthogonalOrderPreserved(before, after),
			nearestNeighbour: nearestNeighbourPreserved(before, after),
		}
	})
	const page = union(topLevel(run.steps.at(-1)?.shapes ?? []).map((shape) => shape.bounds))
	const graphs = steps.flatMap((step) => (step.graph ? [step.graph] : []))
	return {
		flavour: run.flavour,
		steps,
		stability,
		footprint: { w: page?.w ?? 0, h: page?.h ?? 0 },
		aggregate: {
			graph: {
				crossings: mean(graphs.map((graph) => graph.crossings)),
				backwardEdges: Math.max(0, ...graphs.map((graph) => graph.backwardEdges)),
				edgeLengthCv: mean(graphs.map((graph) => graph.edgeLengthCv)),
				aspect: mean(graphs.map((graph) => graph.aspect)),
			},
			userShapesMoved: sum(steps.map((step) => step.userShapesMoved.length)),
			...optional('anchorsKept', steps.at(-1)?.anchorsKept),
			claudeClaudeOverlaps: Math.max(0, ...steps.map((s) => s.overlaps.claudeClaude.length)),
			claudeUserOverlaps: Math.max(0, ...steps.map((s) => s.overlaps.claudeUser.length)),
			...optional('focusDistance', meanOf(steps.map((step) => step.focusDistance))),
			...optional('viewportFit', minOf(steps.map((step) => step.viewportFit))),
			zoom: Math.min(...steps.map((step) => step.zoom)),
			stability: {
				meanDisplacement: mean(stability.map((s) => s.meanDisplacement)),
				maxDisplacement: Math.max(0, ...stability.map((s) => s.maxDisplacement)),
				orthogonalOrder: mean(stability.map((s) => s.orthogonalOrder)),
				nearestNeighbour: mean(stability.map((s) => s.nearestNeighbour)),
			},
		},
	}
}

function scoreStep(step: StepRecord, reference: StepRecord | undefined, scene: Scene): StepScore {
	const nodes = decisionNodes(step.shapes)
	const blocks = topLevel(step.shapes)
	const claude = blocks.filter((shape) => shape.owner === 'claude')
	const user = blocks.filter((shape) => shape.owner === 'user')
	const claudeUser = user.flatMap((annotation) =>
		overlappingPairs(
			// A user shape on the shape it annotates is where the user put it, not in the way.
			claude
				.filter(
					(shape) =>
						!(annotation.anchor?.shapeId === shape.id && annotation.anchor.relation === 'on'),
				)
				.map(labelled),
			[labelled(annotation)],
		),
	)
	const fits = step.calls.flatMap((call) => call.viewportFit ?? [])
	return {
		name: step.name,
		...optional('graph', nodes.size > 0 ? scoreGraph(nodes, dependencies(step.shapes)) : undefined),
		userShapesMoved: step.userShapesMoved,
		...optional('anchorsKept', reference && anchorsKept(step, reference, scene.annotations.ids)),
		overlaps: { claudeClaude: overlappingPairs(claude.map(labelled)), claudeUser },
		...optional('focusDistance', step.focus && boxGap(step.focus.content, step.focus.subject)),
		...optional('viewportFit', fits.length > 0 ? Math.min(...fits) : undefined),
		zoom: step.zoom,
	}
}

function scoreGraph(nodes: Map<string, PageBox>, edges: Edge[]): GraphScore {
	return {
		crossings: normalisedCrossings(nodes, edges),
		backwardEdges: backwardEdges(nodes, edges),
		edgeLengthCv: edgeLengthCv(nodes, edges),
		aspect: blockAspect([...nodes.values()]),
	}
}

/** How many of the tracked annotations are still there and anchored to the same shape (or to none) as in `reference`. */
function anchorsKept(step: StepRecord, reference: StepRecord, ids: readonly string[]) {
	const anchorIn = (record: StepRecord, id: string) => {
		const shape = record.shapes.find((s) => s.id === id)
		return shape ? (shape.anchor?.shapeId ?? null) : undefined
	}
	const kept = ids.filter((id) => {
		const now = anchorIn(step, id)
		return now !== undefined && now === anchorIn(reference, id)
	}).length
	return { kept, total: ids.length }
}

/** Decision nodes by decision id. */
function decisionNodes(shapes: CanvasShape[]): Map<string, PageBox> {
	return new Map(
		shapes.flatMap((shape) =>
			shape.role === 'decision_node' && shape.decisionId
				? [[shape.decisionId, shape.bounds] as const]
				: [],
		),
	)
}

/** Dependencies as edges between decision ids, read from the arrows' bindings. */
function dependencies(shapes: CanvasShape[]): Edge[] {
	const decisionOf = new Map(shapes.map((shape) => [shape.id, shape.decisionId]))
	return shapes.flatMap((shape) => {
		if (shape.role !== 'dependency' || !shape.fromShapeId || !shape.toShapeId) return []
		const from = decisionOf.get(shape.fromShapeId)
		const to = decisionOf.get(shape.toShapeId)
		return from && to ? [{ from, to }] : []
	})
}

/** Shapes that take up room of their own: on the page, not inside a frame, and not arrows. */
function topLevel(shapes: CanvasShape[]): CanvasShape[] {
	return shapes.filter((shape) => !shape.frameId && shape.type !== 'arrow')
}

function labelled(shape: CanvasShape): Labelled {
	return { label: labelOf(shape), bounds: shape.bounds }
}

function labelOf(shape: CanvasShape): string {
	if (shape.owner === 'user') return `user:${shape.id.replace(/^shape:/, '')}`
	switch (shape.role) {
		case 'decision_node':
			return `node:${shape.decisionId}`
		case 'question_card':
			return 'card'
		case 'prototype_frame':
			return `prototype:${shape.prototype?.label}`
		case 'diagram_frame':
			return `diagram:${shape.diagram?.frame ?? shape.text}`
		case 'agent_note':
			return 'claude-note'
		default:
			return `${shape.role}:${shape.id.replace(/^shape:/, '')}`
	}
}

// --- Formatting -----------------------------------------------------------------------------

type Row = [label: string, ...cells: string[]]

const fixed = (digits: number) => (value: number | undefined) =>
	value === undefined ? '-' : value.toFixed(digits)
const ratio = fixed(2)
const units = fixed(0)
const count = (value: number | undefined) => (value === undefined ? '-' : String(value))
const anchors = (value: StepScore['anchorsKept']) => (value ? `${value.kept}/${value.total}` : '-')

/** The scorecard as text: a table of the metrics per step, the shapes behind the ownership and overlap counts, stability and footprint. */
export function formatScorecard(card: Scorecard): string {
	const { steps, aggregate } = card
	const perStep = (cell: (step: StepScore) => string, all: string): string[] => [
		...steps.map(cell),
		all,
	]
	const rows: Row[] = [
		['', ...steps.map((step, index) => `${index + 1} ${step.name}`), 'all'],
		[
			'Crossings (1 = none)',
			...perStep((s) => ratio(s.graph?.crossings), ratio(aggregate.graph.crossings)),
		],
		[
			'Backward edges',
			...perStep((s) => count(s.graph?.backwardEdges), count(aggregate.graph.backwardEdges)),
		],
		[
			'Edge length CV',
			...perStep((s) => ratio(s.graph?.edgeLengthCv), ratio(aggregate.graph.edgeLengthCv)),
		],
		[
			'Graph aspect |ln w/h|',
			...perStep((s) => ratio(s.graph?.aspect), ratio(aggregate.graph.aspect)),
		],
		[
			'User shapes moved',
			...perStep((s) => count(s.userShapesMoved.length), count(aggregate.userShapesMoved)),
		],
		['Anchors kept', ...perStep((s) => anchors(s.anchorsKept), anchors(aggregate.anchorsKept))],
		[
			'Overlaps Claude/Claude',
			...perStep(
				(s) => count(s.overlaps.claudeClaude.length),
				count(aggregate.claudeClaudeOverlaps),
			),
		],
		[
			'Overlaps Claude/user',
			...perStep((s) => count(s.overlaps.claudeUser.length), count(aggregate.claudeUserOverlaps)),
		],
		['Focus distance', ...perStep((s) => units(s.focusDistance), units(aggregate.focusDistance))],
		['Viewport fit', ...perStep((s) => ratio(s.viewportFit), ratio(aggregate.viewportFit))],
		['Zoom', ...perStep((s) => ratio(s.zoom), ratio(aggregate.zoom))],
	]
	const findings = steps.flatMap((step, index) =>
		[
			...step.userShapesMoved.map((id) => `user shape moved ${id.replace(/^shape:/, '')}`),
			...step.overlaps.claudeClaude.map((pair) => `overlap Claude/Claude ${pair.join(' x ')}`),
			...step.overlaps.claudeUser.map((pair) => `overlap Claude/user   ${pair.join(' x ')}`),
		].map((finding) => `  ${index + 1} ${step.name}: ${finding}`),
	)
	const spans = card.stability
	const stabilityRows: Row[] = [
		['', ...spans.map((span) => `${span.from}->${span.to}`), 'all'],
		[
			'Mean displacement',
			...spans.map((s) => units(s.meanDisplacement)),
			units(aggregate.stability.meanDisplacement),
		],
		[
			'Max displacement',
			...spans.map((s) => units(s.maxDisplacement)),
			units(aggregate.stability.maxDisplacement),
		],
		[
			'Orthogonal order kept',
			...spans.map((s) => ratio(s.orthogonalOrder)),
			ratio(aggregate.stability.orthogonalOrder),
		],
		[
			'Nearest neighbour kept',
			...spans.map((s) => ratio(s.nearestNeighbour)),
			ratio(aggregate.stability.nearestNeighbour),
		],
	]
	const { w, h } = card.footprint
	return [
		table(rows),
		'',
		'Moved user shapes and overlapping pairs:',
		...(findings.length > 0 ? findings : ['  none']),
		'',
		table(stabilityRows),
		'',
		`Footprint after the last step: ${units(w)} x ${units(h)} ` +
			`(${units((w * h) / 1e6)} M units², aspect w/h ${ratio(w / Math.max(1, h))})`,
	].join('\n')
}

/** The aggregate of every flavour side by side. */
export function formatComparison(cards: Scorecard[]): string {
	const column = (cell: (card: Scorecard) => string, label: string): Row => [
		label,
		...cards.map(cell),
	]
	return table([
		['', ...cards.map((card) => card.flavour)],
		column((c) => ratio(c.aggregate.graph.crossings), 'Crossings (1 = none)'),
		column((c) => count(c.aggregate.graph.backwardEdges), 'Backward edges'),
		column((c) => ratio(c.aggregate.graph.edgeLengthCv), 'Edge length CV'),
		column((c) => ratio(c.aggregate.graph.aspect), 'Graph aspect |ln w/h|'),
		column((c) => units(c.aggregate.stability.meanDisplacement), 'Mean displacement'),
		column((c) => units(c.aggregate.stability.maxDisplacement), 'Max displacement'),
		column((c) => ratio(c.aggregate.stability.orthogonalOrder), 'Orthogonal order kept'),
		column((c) => ratio(c.aggregate.stability.nearestNeighbour), 'Nearest neighbour kept'),
		column((c) => count(c.aggregate.userShapesMoved), 'User shapes moved'),
		column((c) => anchors(c.aggregate.anchorsKept), 'Anchors kept'),
		column((c) => count(c.aggregate.claudeClaudeOverlaps), 'Overlaps Claude/Claude'),
		column((c) => count(c.aggregate.claudeUserOverlaps), 'Overlaps Claude/user'),
		column((c) => units(c.aggregate.focusDistance), 'Focus distance'),
		column((c) => ratio(c.aggregate.viewportFit), 'Viewport fit'),
		column((c) => `${units(c.footprint.w)} x ${units(c.footprint.h)}`, 'Footprint'),
	])
}

function table(rows: Row[]): string {
	const widths = rows[0]?.map((_, column) =>
		Math.max(...rows.map((row) => row[column]?.length ?? 0)),
	)
	return rows
		.map((row) =>
			row
				.map((cell, column) =>
					column === 0 ? cell.padEnd(widths?.[column] ?? 0) : cell.padStart(widths?.[column] ?? 0),
				)
				.join('  '),
		)
		.join('\n')
}

// --- Helpers --------------------------------------------------------------------------------

/** `{ [key]: value }` when the value is defined, else nothing: keeps optional fields absent. */
function optional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
	return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}

function sum(values: number[]): number {
	return values.reduce((total, value) => total + value, 0)
}

function mean(values: number[]): number {
	return values.length === 0 ? 0 : sum(values) / values.length
}

function meanOf(values: (number | undefined)[]): number | undefined {
	const defined = values.filter((value): value is number => value !== undefined)
	return defined.length === 0 ? undefined : mean(defined)
}

function minOf(values: (number | undefined)[]): number | undefined {
	const defined = values.filter((value): value is number => value !== undefined)
	return defined.length === 0 ? undefined : Math.min(...defined)
}
