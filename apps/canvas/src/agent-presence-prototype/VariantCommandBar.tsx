// PROTOTYPE (throwaway). Variant D: no avatar, no panel. One prompt bar floating above
// the toolbar (Ctrl/Cmd+K), a live ticker of what Claude is doing right now, and an
// ambient glow on the canvas edge while it works. The transcript folds out of the bar.
// Plumbing it implies: the thinnest one, a prompt box that injects into the running
// Claude Code session (channel) plus a status feed; the terminal stays the full log.
import { useEffect, useRef, useState } from 'react'
import type { TLComponents } from 'tldraw'
import { FocusHighlights, PrototypeCanvas, useAgent } from './shared'
import { agent } from './stubAgent'

export const name = 'Command bar + live ticker'

function CommandBar() {
	const { status, label, step, messages } = useAgent()
	const [draft, setDraft] = useState('')
	const [log, setLog] = useState(false)
	const input = useRef<HTMLInputElement>(null)
	const busy = status !== 'idle'
	const last = [...messages].reverse().find((m) => m.from === 'agent' && m.kind === 'speech')

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault()
				e.stopPropagation()
				input.current?.focus()
			}
		}
		window.addEventListener('keydown', onKey, true)
		return () => window.removeEventListener('keydown', onKey, true)
	}, [])

	return (
		<>
			<div className="ap-edgeglow" data-busy={busy} />
			<div className="ap-cmd" onPointerDown={(e) => e.stopPropagation()}>
				{log && (
					<div className="ap-cmd__log">
						{messages.map((m) => (
							<div key={m.id} className={`ap-cmd__line ap-cmd__line--${m.from}-${m.kind}`}>
								{m.kind === 'action'
									? `✎ ${m.text}`
									: `${m.from === 'agent' ? 'Claude' : 'You'}: ${m.text}`}
							</div>
						))}
					</div>
				)}
				<button
					type="button"
					className="ap-cmd__ticker"
					onClick={() => setLog((l) => !l)}
					title="Show transcript"
				>
					{busy ? (
						<>
							<span className="ap-dot" data-status={status} />
							<span>{label}…</span>
							{step && (
								<span className="ap-cmd__progress">
									<span style={{ width: `${(100 * step.done) / step.total}%` }} />
								</span>
							)}
						</>
					) : (
						<span className="ap-cmd__last">{last ? `Claude: ${last.text}` : 'Claude is here'}</span>
					)}
					<span className="ap-muted">{log ? '▾' : '▴'}</span>
				</button>
				<form
					onSubmit={(e) => {
						e.preventDefault()
						if (draft.trim()) agent.send(draft.trim())
						setDraft('')
					}}
				>
					<input
						ref={input}
						value={draft}
						placeholder={busy ? 'Steer: "stop", "make them red"…' : 'Ask or tell Claude…   ⌘K'}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => e.key === 'Escape' && input.current?.blur()}
					/>
				</form>
			</div>
		</>
	)
}

const components: TLComponents = {
	InFrontOfTheCanvas: () => (
		<>
			<FocusHighlights glow />
			<CommandBar />
		</>
	),
}

export function VariantCommandBar() {
	return <PrototypeCanvas components={components} />
}
