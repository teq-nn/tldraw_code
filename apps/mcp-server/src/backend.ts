export type CanvasBackend = 'desktop' | 'vite'

/**
 * `CANVAS_BACKEND` selection (ticket #19): tldraw offline (`desktop`) is the
 * default backend; the Vite app (`vite`) is an explicit fallback kept around
 * until the Vite app itself is retired. Anything other than exactly `"vite"`
 * — unset, `"desktop"`, or an unrecognized value — resolves to `desktop`,
 * so a typo never silently falls back to the Vite app a new user hasn't
 * started.
 */
export function resolveCanvasBackend(value: string | undefined): CanvasBackend {
	return value === 'vite' ? 'vite' : 'desktop'
}
