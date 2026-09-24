// @vitest-environment jsdom
import type { Editor, TLGeoShape, TLShapeId } from 'tldraw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCommandHandlers } from '../src/bridge/commandHandlers'
import { createTestEditor } from './createTestEditor'

let editor: Editor

beforeEach(() => {
	editor = createTestEditor()
})

afterEach(() => editor.dispose())

describe('smoke.create_shape', () => {
	it('creates one labelled rectangle inside the current viewport', async () => {
		const handlers = createCommandHandlers(editor)

		const { shapeId } = await handlers['smoke.create_shape']({ text: 'Hello' })

		const shape = editor.getShape<TLGeoShape>(shapeId as TLShapeId)
		expect(shape).toBeDefined()
		expect(editor.getCurrentPageShapes()).toHaveLength(1)
		expect(shape?.props.geo).toBe('rectangle')
		expect(JSON.stringify(shape?.props.richText)).toContain('Hello')
		const bounds = editor.getShapePageBounds(shapeId as TLShapeId)
		const viewport = editor.getViewportPageBounds()
		expect(bounds && viewport.contains(bounds)).toBe(true)
	})
})
