import { useMemo, useState } from 'react'
import { type Editor, type TLComponents, Tldraw } from 'tldraw'
import { QuestionCardShapeUtil } from './ask/QuestionCardShapeUtil'
import { BASELINE_FLAVOUR, findLayoutFlavour, type LayoutFlavour } from './bridge/layoutFlavours'
import { useCanvasBridge } from './bridge/useCanvasBridge'
import { CanvasFrameShapeUtil } from './comparison/CanvasFrameShapeUtil'
import { hideCollapsedContent } from './comparison/comparisonFrames'
import { BridgeStatusPill } from './components/BridgeStatusPill'
import { LayoutDemo } from './demo/LayoutDemo'
import { PrototypeShapeUtil } from './prototype/PrototypeShapeUtil'
import { openSnapshot } from './snapshot/openSnapshot'

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
 *
 * Three URL parameters: `?layout=<flavour>` runs Claude's commands with that
 * layout flavour (`src/bridge/layoutFlavours.ts`; the baseline by default),
 * `?snapshot=<url>` shows a saved canvas, such as one the layout benchmark
 * wrote, instead of the live one, and `?demo` walks through the benchmark's
 * runs side by side, step by step.
 */
export function App() {
	const params = new URLSearchParams(window.location.search)
	if (params.has('demo')) return <LayoutDemo shapeUtils={shapeUtils} />
	const snapshot = params.get('snapshot')
	if (snapshot) return <SnapshotCanvas url={snapshot} />
	return <LiveCanvas flavour={layoutFlavourNamed(params.get('layout'))} />
}

function layoutFlavourNamed(name: string | null): LayoutFlavour {
	if (!name) return BASELINE_FLAVOUR
	const flavour = findLayoutFlavour(name)
	if (!flavour) console.warn(`Unknown layout flavour "${name}"; using the baseline.`)
	return flavour ?? BASELINE_FLAVOUR
}

function LiveCanvas({ flavour }: { flavour: LayoutFlavour }) {
	const [editor, setEditor] = useState<Editor>()
	const { status, working } = useCanvasBridge(editor, flavour)

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

/**
 * A saved canvas, for looking at: not persisted and not connected to the
 * bridge, so neither the live canvas nor Claude's session is touched.
 */
function SnapshotCanvas({ url }: { url: string }) {
	const [label, setLabel] = useState(`Opening ${url}…`)

	const components = useMemo<TLComponents>(
		() => ({
			TopPanel: () => (
				<div className="bridge-status" data-status="disconnected">
					{label}
				</div>
			),
		}),
		[label],
	)

	const open = async (editor: Editor) => {
		try {
			const response = await fetch(url)
			if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
			openSnapshot(editor, await response.text())
			setLabel(`Snapshot ${url} (not connected to Claude)`)
		} catch (error) {
			setLabel(`Could not open ${url}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	return (
		<div className="canvas-app">
			<Tldraw
				shapeUtils={shapeUtils}
				components={components}
				getShapeVisibility={hideCollapsedContent}
				onMount={(editor) => {
					void open(editor)
				}}
			/>
		</div>
	)
}
