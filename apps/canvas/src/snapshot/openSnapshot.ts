import { type Editor, parseTldrawJsonFile } from 'tldraw'

/**
 * Replace the editor's document with a saved canvas (a `.tldr` file, such
 * as the layout benchmark writes) and zoom to fit it. Throws when the file is
 * not a snapshot this canvas can read, e.g. one with shapes it does not know.
 */
export function openSnapshot(editor: Editor, json: string): void {
	const parsed = parseTldrawJsonFile({ schema: editor.store.schema, json })
	if (!parsed.ok) throw new Error(`Not a canvas snapshot (${parsed.error.type}).`)
	editor.loadSnapshot(parsed.value.getStoreSnapshot())
	editor.clearHistory()
	editor.zoomToFit()
}
