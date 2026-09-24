import { useMemo, useState } from 'react'
import { type Editor, type TLComponents, Tldraw } from 'tldraw'
import { useCanvasBridge } from './bridge/useCanvasBridge'
import { BridgeStatusPill } from './components/BridgeStatusPill'

/**
 * App shell derived from the tldraw Agent Starter Kit (MIT, see
 * LICENSE-agent-starter-kit.md). The kit's chat panel and LLM worker are
 * replaced by the MCP bridge: Claude Code drives the canvas instead.
 */
export function App() {
	const [editor, setEditor] = useState<Editor>()
	const status = useCanvasBridge(editor)

	const components = useMemo<TLComponents>(
		() => ({ TopPanel: () => <BridgeStatusPill status={status} /> }),
		[status],
	)

	return (
		<div className="canvas-app">
			<Tldraw persistenceKey="tldraw-code-canvas" components={components} onMount={setEditor} />
		</div>
	)
}
