import {
	createTLStore,
	defaultAddFontsFromNode,
	defaultBindingUtils,
	defaultShapeUtils,
	Editor,
	tipTapDefaultExtensions,
} from 'tldraw'

/** A headless tldraw editor with the default shapes, for tests running under jsdom. */
export function createTestEditor(): Editor {
	return new Editor({
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
}
