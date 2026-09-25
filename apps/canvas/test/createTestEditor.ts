import {
	createTLStore,
	defaultAddFontsFromNode,
	defaultBindingUtils,
	defaultShapeUtils,
	Editor,
	type TLAnyShapeUtilConstructor,
	tipTapDefaultExtensions,
} from 'tldraw'
import { QuestionCardShapeUtil } from '../src/ask/QuestionCardShapeUtil'
import { PrototypeShapeUtil } from '../src/prototype/PrototypeShapeUtil'

/** A headless tldraw editor with the default shapes and ours, for tests running under jsdom. */
export function createTestEditor(
	options: Pick<ConstructorParameters<typeof Editor>[0], 'getShapeVisibility'> = {},
): Editor {
	const shapeUtils: TLAnyShapeUtilConstructor[] = [
		...defaultShapeUtils,
		QuestionCardShapeUtil,
		PrototypeShapeUtil,
	]
	return new Editor({
		store: createTLStore({ shapeUtils, bindingUtils: defaultBindingUtils }),
		shapeUtils,
		bindingUtils: defaultBindingUtils,
		tools: [],
		getContainer: () => document.body,
		...options,
		// <Tldraw> normally supplies these; a bare Editor needs them to measure rich text.
		options: {
			text: {
				addFontsFromNode: defaultAddFontsFromNode,
				tipTapConfig: { extensions: tipTapDefaultExtensions },
			},
		},
	})
}
