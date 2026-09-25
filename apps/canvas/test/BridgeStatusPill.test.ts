import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BridgeStatusPill } from '../src/components/BridgeStatusPill'

const render = (props: {
	status: 'connected' | 'connecting' | 'disconnected'
	working?: boolean
}) => renderToStaticMarkup(createElement(BridgeStatusPill, props))

describe('BridgeStatusPill', () => {
	it('shows the connection status without dots by default', () => {
		const html = render({ status: 'connected' })
		expect(html).toContain('data-status="connected"')
		expect(html).toContain('data-working="false"')
		expect(html).toContain('Claude Code connected')
		expect(html).not.toContain('bridge-status__working')
	})

	it('shows three dots and a working label while Claude is working', () => {
		const html = render({ status: 'connected', working: true })
		expect(html).toContain('data-working="true"')
		expect(html).toContain('Claude is working…')
		expect(html.match(/bridge-status__working-dot/g)).toHaveLength(3)
	})

	it('never shows Claude as working while the bridge is not connected', () => {
		for (const status of ['connecting', 'disconnected'] as const) {
			const html = render({ status, working: true })
			expect(html).toContain('data-working="false"')
			expect(html).not.toContain('Claude is working')
		}
	})
})
