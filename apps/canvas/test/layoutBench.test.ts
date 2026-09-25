// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { runScene, type SceneRun } from '../bench/runScene'
import { SCENE, USER_SHAPES } from '../bench/scene'
import { BASELINE_FLAVOUR } from '../src/bridge/layoutFlavours'
import { hideCollapsedContent } from '../src/comparison/comparisonFrames'
import { openSnapshot } from '../src/snapshot/openSnapshot'
import { createTestEditor } from './createTestEditor'

// The layout benchmark's scene (issue #25) against today's layout, headless.

let run: SceneRun | undefined
const baseline = async () => {
	run ??= await runScene(BASELINE_FLAVOUR, SCENE)
	return run
}

describe('the layout benchmark scene', () => {
	it('records the canvas after every step', async () => {
		const { steps } = await baseline()
		expect(steps.map((step) => step.name)).toEqual(SCENE.steps.map((step) => step.name))
		const last = steps.at(-1)
		const decisions = last?.shapes.filter((shape) => shape.role === 'decision_node')
		// 12, then 3 added and 1 removed, then 2 more.
		expect(decisions).toHaveLength(16)
		expect(last?.shapes.some((shape) => shape.role === 'agent_note')).toBe(true)
	})

	it('keeps every user annotation it tracks on the canvas', async () => {
		const last = (await baseline()).steps.at(-1)
		const ids = new Set(last?.shapes.map((shape) => shape.id))
		for (const id of SCENE.annotations.ids) expect(ids.has(id)).toBe(true)
		// The note that answered the card went with the card (ADR 0010).
		expect(ids.has(USER_SHAPES.answer)).toBe(false)
	})
})

describe('openSnapshot', () => {
	const editors: ReturnType<typeof createTestEditor>[] = []
	afterEach(() => {
		for (const editor of editors.splice(0)) editor.dispose()
	})

	it("opens the scene's final canvas with every shape on it", async () => {
		const { snapshot, steps } = await baseline()
		const editor = createTestEditor({ getShapeVisibility: hideCollapsedContent })
		editors.push(editor)

		openSnapshot(editor, snapshot)

		const opened = editor.getCurrentPageShapes().map((shape) => shape.id)
		expect(opened.sort()).toEqual(
			steps
				.at(-1)
				?.shapes.map((shape) => shape.id)
				.sort(),
		)
	})

	it('refuses a file that is not a canvas snapshot', () => {
		const editor = createTestEditor()
		editors.push(editor)
		expect(() => openSnapshot(editor, '{"hello":"world"}')).toThrow(/not a canvas snapshot/i)
	})
})
