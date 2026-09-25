// PROTOTYPE (throwaway). Variant B: Claude as a creature on the canvas, like
// fairies.tldraw.com. No chat window: it flies to what it works on and speaks in a
// bubble; you talk to it where it is (click it, or press "/"). History is one click away.
// Plumbing it implies: the agent streams where it is looking/acting, not just results,
// so the loop has to live in (or report through) something the canvas talks to live.
import { useEffect, useRef, useState } from 'react'
import type { TLComponents } from 'tldraw'
import { FocusHighlights, isTyping, PrototypeCanvas, useAgent, useViewportPoint } from './shared'
import { agent } from './stubAgent'

export const name = 'Fairy on the canvas'

function Fairy() {
	const { cursor, status, label, messages } = useAgent()
	const p = useViewportPoint(cursor)
	const [open, setOpen] = useState(false)
	const [history, setHistory] = useState(false)
	const [draft, setDraft] = useState('')
	const [fresh, setFresh] = useState(true)
	const input = useRef<HTMLInputElement>(null)
	const lastSpeech = [...messages].reverse().find((m) => m.from === 'agent' && m.kind === 'speech')

	// A new line from the fairy shows for a while, then fades.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on new line
	useEffect(() => {
		setFresh(true)
		const t = setTimeout(() => setFresh(false), 7000)
		return () => clearTimeout(t)
	}, [lastSpeech?.id])

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === '/' && !isTyping(e)) {
				e.preventDefault()
				e.stopPropagation()
				setOpen(true)
			}
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [])
	useEffect(() => {
		if (open) input.current?.focus()
	}, [open])

	if (!p) return null
	const busy = status !== 'idle'
	return (
		<div className="ap-fairy" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
			<button
				type="button"
				className="ap-fairy__body"
				data-busy={busy}
				title="Talk to Claude (/)"
				onPointerDown={(e) => e.stopPropagation()}
				onClick={() => setOpen((o) => !o)}
			>
				<span className="ap-fairy__wing ap-fairy__wing--l" />
				<span className="ap-fairy__wing ap-fairy__wing--r" />
				<span className="ap-fairy__core" />
			</button>
			<div className="ap-fairy__speech" onPointerDown={(e) => e.stopPropagation()}>
				{busy && <div className="ap-fairy__bubble ap-fairy__bubble--status">{label}…</div>}
				{history ? (
					<div className="ap-fairy__history">
						{messages
							.filter((m) => m.kind === 'speech')
							.slice(-8)
							.map((m) => (
								<div key={m.id} className={`ap-fairy__line ap-fairy__line--${m.from}`}>
									{m.text}
								</div>
							))}
					</div>
				) : (
					lastSpeech &&
					(fresh || open) && (
						<button
							type="button"
							className="ap-fairy__bubble"
							title="Show history"
							onClick={() => setHistory(true)}
						>
							{lastSpeech.text}
						</button>
					)
				)}
				{open && (
					<form
						className="ap-fairy__input"
						onSubmit={(e) => {
							e.preventDefault()
							if (draft.trim()) agent.send(draft.trim())
							setDraft('')
						}}
					>
						<input
							ref={input}
							value={draft}
							placeholder={busy ? 'Steer me…' : 'Tell me…'}
							onChange={(e) => setDraft(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Escape') {
									setOpen(false)
									setHistory(false)
								}
							}}
						/>
						<button type="button" className="ap-link" onClick={() => setHistory((h) => !h)}>
							{history ? 'hide log' : 'log'}
						</button>
					</form>
				)}
			</div>
		</div>
	)
}

const components: TLComponents = {
	InFrontOfTheCanvas: () => (
		<>
			<FocusHighlights glow />
			<Fairy />
		</>
	),
}

export function VariantFairy() {
	return <PrototypeCanvas components={components} />
}
