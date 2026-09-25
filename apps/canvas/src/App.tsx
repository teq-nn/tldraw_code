import { useMemo, useState } from 'react'
import { type Editor, type TLComponents, Tldraw } from 'tldraw'
import { QuestionCardShapeUtil } from './ask/QuestionCardShapeUtil'
import { useCanvasBridge } from './bridge/useCanvasBridge'
import { CanvasFrameShapeUtil } from './comparison/CanvasFrameShapeUtil'
import { hideCollapsedContent } from './comparison/comparisonFrames'
import { BridgeStatusPill } from './components/BridgeStatusPill'
import { PrototypeShapeUtil } from './prototype/PrototypeShapeUtil'

// Frames show their colour, so a settled comparison's chosen alternative stands out in green (ADR 0021),
// and a rejected one keeps its hidden diagram when the user moves it (ADR 0027).
const shapeUtils = [
	QuestionCardShapeUtil,
	PrototypeShapeUtil,
	CanvasFrameShapeUtil.configure({ showColors: true }),
]

/**
 * App shell derived from the tldraw Agent Starter Kit (MIT, see
 * LICENSE-agent-starter-kit.md). The kit's chat panel and LLM worker are
 * replaced by the MCP bridge: Claude Code drives the canvas instead.
 */
export function App() {
	const [editor, setEditor] = useState<Editor>()
	const { status, working } = useCanvasBridge(editor)

	const components = useMemo<TLComponents>(
		() => ({ TopPanel: () => <BridgeStatusPill status={status} working={working} /> }),
		[status, working],
	)

	return (
		<div className="canvas-app">
			<Tldraw
				persistenceKey="tldraw-code-canvas"
				shapeUtils={shapeUtils}
				components={components}
				getShapeVisibility={hideCollapsedContent}
				onMount={setEditor}
			/>
		</div>
	)
}
