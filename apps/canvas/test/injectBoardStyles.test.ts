// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { injectBoardStyles } from '../src/board-script/injectBoardStyles'

afterEach(() => {
	document.head.innerHTML = ''
})

describe('injectBoardStyles', () => {
	it('adds the css to the page, stripping @import (the host already loads tldraw.css)', () => {
		injectBoardStyles('@import url("tldraw/tldraw.css");\n.bridge-status { color: red; }')

		const style = document.head.querySelector('style[data-tldraw-code-board-script]')
		expect(style).not.toBeNull()
		expect(style?.textContent).not.toContain('@import')
		expect(style?.textContent).toContain('.bridge-status { color: red; }')
	})

	it('is idempotent: a second call does not add a second style tag', () => {
		injectBoardStyles('.a { color: red; }')
		injectBoardStyles('.b { color: blue; }')

		const styles = document.head.querySelectorAll('style[data-tldraw-code-board-script]')
		expect(styles).toHaveLength(1)
		expect(styles[0]?.textContent).toContain('.a')
	})
})
