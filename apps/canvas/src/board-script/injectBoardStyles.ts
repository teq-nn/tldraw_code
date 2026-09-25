const MARKER_ATTR = 'data-tldraw-code-board-script'

/**
 * Inject the canvas's own CSS (question card, prototype frame, bridge pill —
 * `index.css`, minus its `@import` of `tldraw/tldraw.css`: the host app
 * already loads the SDK's base styles for its own editor) into the page.
 * Idempotent across board-script reruns by checking the DOM, not module
 * state: `main.js` gets a fresh module instance on every rerun, but the
 * `<style>` tag it appended earlier is still there.
 */
export function injectBoardStyles(css: string): void {
	if (document.querySelector(`style[${MARKER_ATTR}]`)) return
	const style = document.createElement('style')
	style.setAttribute(MARKER_ATTR, '')
	style.textContent = css.replace(/@import[^;]*;/g, '')
	document.head.appendChild(style)
}
