// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BoardTopPanel } from '../src/board-script/BoardTopPanel'
import { publishBridgeState } from '../src/board-script/bridgeStatusChannel'

describe('BoardTopPanel', () => {
	it('renders the same pill as the Vite canvas, reading the published bridge state', () => {
		expect(renderToStaticMarkup(createElement(BoardTopPanel))).toContain(
			'data-status="disconnected"',
		)

		publishBridgeState({ status: 'connected', working: true })

		const html = renderToStaticMarkup(createElement(BoardTopPanel))
		expect(html).toContain('data-status="connected"')
		expect(html).toContain('Claude is working…')
	})
})
