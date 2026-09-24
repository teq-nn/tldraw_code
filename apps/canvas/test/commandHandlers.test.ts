// @vitest-environment jsdom
import {
	createTLStore,
	defaultAddFontsFromNode,
	defaultBindingUtils,
	defaultShapeUtils,
	Editor,
	type TLGeoShape,
	type TLShapeId,
	tipTapDefaultExtensions,
} from 'tldraw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCommandHandlers } from '../src/bridge/commandHandlers'

let editor: Editor

beforeEach(() => {
	editor = new Editor({
		store: createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils }),
		shapeUtils: defaultShapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [],
		getContainer: () => document.body,
		// <Tldraw> normally supplies these; a bare Editor needs them to measure rich text.
		options: {
			text: {
				addFontsFromNode: defaultAddFontsFromNode,
				tipTapConfig: { extensions: tipTapDefaultExtensions },
			},
		},
	})
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
