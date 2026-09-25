// PROTOTYPE (throwaway). Variant C: the conversation lives on the canvas as threads,
// each pinned to the shape (or spot) it is about, like Figma comments. Select something
// and press Enter (or "Talk here") to start or continue a thread there; Claude replies in
// it. Several conversations at once, all spatial. Plumbing it implies: today's &agent
// sticky-note channel, grown into real threads with a reply tool.
import { useEffect, useRef, useState } from 'react'
import { type Editor, type TLComponents, type TLShapeId, useEditor, useValue } from 'tldraw'
import { FocusHighlights, isTyping, PrototypeCanvas, useAgent } from './shared'
import { agent, type ChatMessage, type Point } from './stubAgent'

export const name = 'Threads pinned to shapes'

// UI-only state shared between the overlay pieces.
let composeAt: { shapeId?: TLShapeId; at: Point } | undefined
let openThread: string | undefined
const uiListeners = new Set<() => void>()
const setUi = (f: () => void) => {
	f()
	for (const l of uiListeners) l()
}
function useUi() {
	const [, force] = useState(0)
	useEffect(() => {
		const l = () => force((n) => n + 1)
		uiListeners.add(l)
		return () => {
			uiListeners.delete(l)
		}
	}, [])
	return { composeAt, openThread }
}

function anchorOf(editor: Editor, shapeId: TLShapeId | undefined, at: Point) {
	const b = shapeId && editor.getShapePageBounds(shapeId)
	return editor.pageToViewport(b ? { x: b.maxX, y: b.minY } : at)
}

function startHere(editor: Editor) {
	const id = editor.getOnlySelectedShapeId() ?? undefined
	const b = editor.getSelectionPageBounds()
	const at = b ? { x: b.maxX, y: b.minY } : editor.getViewportPageBounds().center
	// Continue the thread already on this shape, if any.
	const existing =
		id && agent.getState().messages.find((m) => m.from === 'user' && m.shapeId === id)
	setUi(() => {
		composeAt = existing ? undefined : { shapeId: id, at }
		openThread = existing ? existing.threadId : undefined
	})
}

function Composer() {
	const editor = useEditor()
	const ui = useUi()
	const [draft, setDraft] = useState('')
	const ref = useRef<HTMLTextAreaElement>(null)
	const c = ui.composeAt
	const p = useValue('composer', () => (c ? anchorOf(editor, c.shapeId, c.at) : undefined), [
		editor,
		c,
	])
	useEffect(() => {
		if (c) ref.current?.focus()
	}, [c])
	if (!c || !p) return null
	return (
		<div
			className="ap-thread ap-thread--open"
			style={{ left: p.x + 12, top: p.y - 12 }}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<div className="ap-muted">New thread{c.shapeId ? ' on this shape' : ' here'}</div>
			<textarea
				ref={ref}
				value={draft}
				placeholder="Say something to Claude about this…"
				onChange={(e) => setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Escape') setUi(() => (composeAt = undefined))
					if (e.key === 'Enter' && !e.shiftKey && draft.trim()) {
						e.preventDefault()
						agent.send(draft.trim(), { shapeId: c.shapeId, at: c.at, newThread: true })
						const t = agent.getState().messages.at(-1)?.threadId
						setDraft('')
						setUi(() => {
							composeAt = undefined
							openThread = t
						})
					}
				}}
			/>
		</div>
	)
}

function Thread({ id, msgs }: { id: string; msgs: ChatMessage[] }) {
	const editor = useEditor()
	const ui = useUi()
	const { status, label, messages } = useAgent()
	const [draft, setDraft] = useState('')
	const first = msgs[0] as ChatMessage
	const p = useValue('thread', () => anchorOf(editor, first.shapeId, first.at), [editor, first])
	const open = ui.openThread === id
	const agentHere = status !== 'idle' && messages.at(-1)?.threadId === id
	const unread = msgs.at(-1)?.from === 'agent' && !open
	return (
		<div
			className="ap-threadpin"
			style={{ left: p.x + 8, top: p.y - 16 }}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<button
				type="button"
				className="ap-threadpin__dot"
				data-unread={unread}
				data-busy={agentHere}
				onClick={() => setUi(() => (openThread = open ? undefined : id))}
			>
				{msgs.filter((m) => m.kind === 'speech').length}
			</button>
			{open && (
				<div className="ap-thread ap-thread--open">
					{msgs.map((m) =>
						m.kind === 'action' ? (
							<div key={m.id} className="ap-panel__action">
								✎ {m.text}
							</div>
						) : (
							<div key={m.id} className={`ap-thread__msg ap-thread__msg--${m.from}`}>
								<b>{m.from === 'agent' ? 'Claude' : 'You'}</b> {m.text}
							</div>
						),
					)}
					{agentHere && <div className="ap-muted">Claude: {label}…</div>}
					<input
						value={draft}
						placeholder="Reply…"
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Escape') setUi(() => (openThread = undefined))
							if (e.key === 'Enter' && draft.trim()) {
								agent.send(draft.trim(), { threadId: id, shapeId: first.shapeId, at: first.at })
								setDraft('')
							}
						}}
					/>
				</div>
			)}
		</div>
	)
}

function Threads() {
	const { messages } = useAgent()
	const byThread = new Map<string, ChatMessage[]>()
	for (const m of messages) byThread.set(m.threadId, [...(byThread.get(m.threadId) ?? []), m])
	// The greeting has no user message; show it as a thread where Claude stands.
	return (
		<>
			{[...byThread].map(([id, msgs]) => (
				<Thread key={id} id={id} msgs={msgs} />
			))}
		</>
	)
}

function TalkHereButton() {
	const editor = useEditor()
	const b = useValue('sel', () => {
		const s = editor.getSelectionPageBounds()
		return s && !editor.getEditingShapeId()
			? editor.pageToViewport({ x: s.midX, y: s.maxY })
			: undefined
	}, [editor])
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (
				e.key === 'Enter' &&
				!isTyping(e) &&
				editor.getSelectedShapeIds().length &&
				!editor.getEditingShapeId()
			) {
				e.preventDefault()
				e.stopPropagation()
				startHere(editor)
			}
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [editor])
	if (!b) return null
	return (
		<button
			type="button"
			className="ap-talkhere"
			style={{ left: b.x, top: b.y + 14 }}
			onPointerDown={(e) => e.stopPropagation()}
			onClick={() => startHere(editor)}
		>
			💬 Talk here <kbd>Enter</kbd>
		</button>
	)
}

function SmallCursor() {
	const editor = useEditor()
	const { cursor } = useAgent()
	const p = useValue('c', () => editor.pageToViewport(cursor), [editor, cursor])
	return (
		<div className="ap-cursor" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
			<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
				<path d="M1 1 L17 7 L9 9 L7 17 Z" fill="#0ea5e9" stroke="white" strokeWidth="1.5" />
			</svg>
			<span className="ap-cursor__name ap-cursor__name--blue">Claude</span>
		</div>
	)
}

const components: TLComponents = {
	InFrontOfTheCanvas: () => (
		<>
			<FocusHighlights />
			<SmallCursor />
			<Threads />
			<TalkHereButton />
			<Composer />
		</>
	),
}

export function VariantThreads() {
	return <PrototypeCanvas components={components} />
}
