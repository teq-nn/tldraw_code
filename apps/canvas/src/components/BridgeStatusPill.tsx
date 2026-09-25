import type { BridgeStatus } from '../bridge/BridgeClient'

const LABELS: Record<BridgeStatus, string> = {
	connected: 'Claude Code connected',
	connecting: 'Connecting to MCP server…',
	disconnected: 'MCP server not running',
}

const WORKING_LABEL = 'Claude is working…'

/**
 * `working` (ADR 0025): Claude got a channel push and has not yet reacted.
 * Only shown while connected, since a dead bridge cannot say Claude is busy.
 */
export function BridgeStatusPill({
	status,
	working = false,
}: {
	status: BridgeStatus
	working?: boolean
}) {
	const busy = working && status === 'connected'
	return (
		<div
			className="bridge-status"
			data-status={status}
			data-working={busy}
			data-testid="bridge-status"
		>
			<span className="bridge-status__dot" />
			{busy ? WORKING_LABEL : LABELS[status]}
			{busy && (
				<span className="bridge-status__typing" aria-hidden="true">
					<span className="bridge-status__typing-dot" />
					<span className="bridge-status__typing-dot" />
					<span className="bridge-status__typing-dot" />
				</span>
			)}
		</div>
	)
}
