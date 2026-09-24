import type { BridgeStatus } from '../bridge/BridgeClient'

const LABELS: Record<BridgeStatus, string> = {
	connected: 'Claude Code connected',
	connecting: 'Connecting to MCP server…',
	disconnected: 'MCP server not running',
}

export function BridgeStatusPill({ status }: { status: BridgeStatus }) {
	return (
		<div className="bridge-status" data-status={status} data-testid="bridge-status">
			<span className="bridge-status__dot" />
			{LABELS[status]}
		</div>
	)
}
