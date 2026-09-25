// PROTOTYPE (throwaway). Variant A: docked chat panel beside the canvas, like the
// tldraw Agent starter kit. Conversation is linear; the canvas shows a named cursor
// and outlines what Claude touches. Plumbing it implies: a local host that owns the
// agent loop (Claude Agent SDK) or a channel into the running Claude Code session.
import { useEffect, useRef, useState } from 'react'
import { type Editor, type TLComponents, useValue } from 'tldraw'
import { FocusHighlights, PrototypeCanvas, useAgent, useViewportPoint } from './shared'
import { agent } from './stubAgent'

export const name = 'Docked chat panel'

function NamedCursor() {
	const { cursor, status } = useAgent()
	const p = useViewportPoint(cursor)
	if (!p) return null
	return (
		<div className="ap-cursor" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
			<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
				<path d="M1 1 L17 7 L9 9 L7 17 Z" fill="#7c3aed" stroke="white" strokeWidth="1.5" />
			</svg>
			<span className="ap-cursor__name">Claude{status !== 'idle' ? ' …' : ''}</span>
		</div>
	)
}

const components: TLComponents = {
	InFrontOfTheCanvas: () => (
		<>
			<FocusHighlights />
			<NamedCursor />
		</>
	),
}

function SelectionChip({ editor }: { editor?: Editor }) {
	const n = useValue('sel', () => editor?.getSelectedShapeIds().length ?? 0, [editor])
	return (
		<div className="ap-panel__chip">
			{n ? `Context: ${n} selected shape${n > 1 ? 's' : ''}` : 'Context: whole canvas'}
		</div>
	)
}

function Panel({ editor }: { editor?: Editor }) {
	const { messages, status, label, step } = useAgent()
	const [draft, setDraft] = useState('')
	const end = useRef<HTMLDivElement>(null)
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new message
	useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [messages.length])
	const submit = () => {
		if (!draft.trim()) return
		agent.send(draft.trim())
		setDraft('')
	}
	return (
		<aside className="ap-panel">
			<header className="ap-panel__head">
				<span className="ap-dot" data-status={status} />
				<b>Claude</b>
				<span className="ap-muted">{status === 'idle' ? 'idle' : label}</span>
				{step && <span className="ap-muted">{`${step.done}/${step.total}`}</span>}
			</header>
			<div className="ap-panel__log">
				{messages.map((m) =>
					m.kind === 'action' ? (
						<div key={m.id} className="ap-panel__action">
							✎ {m.text}
						</div>
					) : (
						<button
							type="button"
							key={m.id}
							className={`ap-bubble ap-bubble--${m.from}`}
							title="Show on canvas"
							onClick={() => editor?.centerOnPoint(m.at, { animation: { duration: 300 } })}
						>
							{m.text}
						</button>
					),
				)}
				<div ref={end} />
			</div>
			<PanelInput
				editor={editor}
				draft={draft}
				setDraft={setDraft}
				submit={submit}
				busy={status !== 'idle'}
			/>
		</aside>
	)
}

function PanelInput(props: {
	editor?: Editor
	draft: string
	setDraft: (s: string) => void
	submit: () => void
	busy: boolean
}) {
	return (
		<div className="ap-panel__input">
			<SelectionChip editor={props.editor} />
			<textarea
				value={props.draft}
				placeholder={props.busy ? 'Steer Claude while it works…' : 'Ask Claude…'}
				onChange={(e) => props.setDraft(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter' && !e.shiftKey) {
						e.preventDefault()
						props.submit()
					}
				}}
			/>
		</div>
	)
}

export function VariantPanel() {
	const [editor, setEditor] = useState<Editor>()
	return (
		<div className="ap-row">
			<div className="ap-row__canvas">
				<PrototypeCanvas components={components} onEditor={setEditor} />
			</div>
			<Panel editor={editor} />
		</div>
	)
}
