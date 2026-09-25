import type { PageBox } from '@tldraw-code/protocol'

/**
 * What the layout demo (`?demo`) walks through: the layout benchmark's scene,
 * step by step, once per run, as `pnpm bench:layout` writes it to
 * `public/bench/demo/manifest.json`. The canvas snapshots it points to sit
 * next to it.
 */
export interface LayoutDemoManifest {
	/** Every step of the longest scene, in order; a run without a step shows its previous one. */
	steps: { name: string; description: string }[]
	runs: LayoutDemoRun[]
}

export interface LayoutDemoRun {
	/** The run's name, e.g. `baseline` or `user-owned+tidy`. */
	name: string
	summary: string
	steps: LayoutDemoStep[]
	/** The scorecard's aggregate row, as the benchmark prints it. */
	totals: { label: string; value: string }[]
}

export interface LayoutDemoStep {
	name: string
	/** The canvas after the step, relative to the manifest. */
	snapshot: string
	/** Page area of what the step is about (the graph when it changed it), with where things were. */
	closeUp: PageBox
	/** Page area of everything on the canvas, now and the step before. */
	overview: PageBox
	stats: { label: string; value: string; bad?: boolean }[]
	highlights: {
		/** Decision nodes the step moved: where they were and where they are. */
		moved: { label: string; shapeId: string; from: PageBox; to: PageBox }[]
		/** Decision nodes the step added. */
		added: PageBox[]
		/** Where two shapes overlap that should not. */
		overlaps: { label: string; box: PageBox }[]
		/** The user's annotations that lost the anchor they had when placed. */
		anchorsLost: { label: string; box: PageBox }[]
		/** The user's shapes one of Claude's commands moved. */
		userMoved: { label: string; box: PageBox }[]
	}
}

export const LAYOUT_DEMO_MANIFEST = 'bench/demo/manifest.json'
