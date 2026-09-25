import { useSyncExternalStore } from 'react'
import { BridgeStatusPill } from '../components/BridgeStatusPill'
import { currentBridgeState, subscribeBridgeState } from './bridgeStatusChannel'

/**
 * `config.js`'s `TopPanel`: the same pill the Vite canvas shows, reading the
 * bridge status `main.js` publishes (ADR: canvas as a board script). No
 * bridge logic lives here — only the wiring from the shared state to the
 * existing component.
 */
export function BoardTopPanel() {
	const state = useSyncExternalStore(subscribeBridgeState, currentBridgeState, currentBridgeState)
	return <BridgeStatusPill status={state.status} working={state.working} />
}
