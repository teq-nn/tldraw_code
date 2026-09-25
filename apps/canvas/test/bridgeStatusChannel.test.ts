// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
	currentBridgeState,
	publishBridgeState,
	subscribeBridgeState,
} from '../src/board-script/bridgeStatusChannel'

describe('bridgeStatusChannel', () => {
	it('starts disconnected before anything is published', () => {
		expect(currentBridgeState()).toEqual({ status: 'disconnected', working: false })
	})

	it('publishes a state that current and later subscribers both see', () => {
		const received: unknown[] = []
		const unsubscribe = subscribeBridgeState((state) => received.push(state))

		publishBridgeState({ status: 'connected', working: true })

		expect(currentBridgeState()).toEqual({ status: 'connected', working: true })
		expect(received).toEqual([{ status: 'connected', working: true }])
		unsubscribe()
	})

	it('stops notifying a subscriber once unsubscribed', () => {
		const received: unknown[] = []
		const unsubscribe = subscribeBridgeState((state) => received.push(state))
		unsubscribe()

		publishBridgeState({ status: 'connecting', working: false })

		expect(received).toEqual([])
	})
})
