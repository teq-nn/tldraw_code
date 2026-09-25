// PROTOTYPE (throwaway): canvas + helpers shared by the agent presence variants.
import { useSyncExternalStore } from 'react'
import {
	createShapeId,
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	type Editor,
	type TLComponents,
	Tldraw,
	toRichText,
	useEditor,
	useValue,
} from 'tldraw'
import { agent, type Point } from './stubAgent'

export const useAgent = () => useSyncExternalStore(agent.subscribe, agent.getState)

/** Page point → viewport point, following the camera. */
export function useViewportPoint(p: Point | undefined) {
	const editor = useEditor()
	return useValue('vp', () => (p ? editor.pageToViewport(p) : undefined), [editor, p?.x, p?.y])
}

/** Outlines the shapes the agent is touching. */
export function FocusHighlights({ glow = false }: { glow?: boolean }) {
	const editor = useEditor()
	const { focus } = useAgent()
	const boxes = useValue(
		'focus boxes',
		() =>
			focus.flatMap((id) => {
				const b = editor.getShapePageBounds(id)
				if (!b) return []
				const tl = editor.pageToViewport({ x: b.minX, y: b.minY })
				const z = editor.getZoomLevel()
				return [{ id, x: tl.x, y: tl.y, w: b.w * z, h: b.h * z }]
			}),
		[editor, focus],
	)
	return (
		<>
			{boxes.map((b) => (
				<div
					key={b.id}
					className={glow ? 'ap-focus ap-focus--glow' : 'ap-focus'}
					style={{ left: b.x - 6, top: b.y - 6, width: b.w + 12, height: b.h + 12 }}
				/>
			))}
		</>
	)
}

// One store for the page: switching variants remounts <Tldraw> but keeps the drawing.
const store = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils })
let seeded = false

function seed(editor: Editor) {
	if (seeded) return
	seeded = true
	const nodes = [
		{ label: 'Where does the chat live?', x: 0, y: 0, color: 'green' },
		{ label: 'Who runs the agent loop?', x: 280, y: -80, color: 'blue' },
		{ label: 'How does Claude show presence?', x: 280, y: 80, color: 'blue' },
		{ label: 'Keep Claude Code as the brain?', x: 560, y: 0, color: 'red' },
	] as const
	editor.createShapes(
		nodes.map((n) => ({
			id: createShapeId(),
			type: 'geo',
			x: n.x,
			y: n.y,
			meta: { label: n.label },
			props: { w: 220, h: 90, color: n.color, richText: toRichText(n.label) },
		})),
	)
	editor.zoomToFit({ animation: { duration: 0 } })
	editor.zoomOut(undefined, { animation: { duration: 0 } })
}

export function PrototypeCanvas({
	components,
	onEditor,
}: {
	components: TLComponents
	onEditor?: (editor: Editor) => void
}) {
	return (
		<Tldraw
			store={store}
			components={components}
			onMount={(editor) => {
				seed(editor)
				agent.attach(editor)
				onEditor?.(editor)
				Object.assign(window, { editor, agent }) // for poking at it from devtools
			}}
		/>
	)
}

export const isTyping = (e: KeyboardEvent) => {
	const t = e.target as HTMLElement | null
	return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}
