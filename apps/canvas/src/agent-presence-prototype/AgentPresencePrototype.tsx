// PROTOTYPE (throwaway, branch prototype/agent-presence).
// Question: how should Claude be present on the canvas so the user can steer it
// without switching to the terminal? Four structurally different answers, driven by
// one scripted stub agent, switchable via `?prototype=agent-presence&variant=A|B|C|D`.
// Open with `pnpm prototype:agent-presence`.
import { useEffect, useState } from 'react'
import './prototype.css'
import { isTyping, useAgent } from './shared'
import * as D from './VariantCommandBar'
import * as B from './VariantFairy'
import * as A from './VariantPanel'
import * as C from './VariantThreads'

const VARIANTS = {
	A: { name: A.name, Component: A.VariantPanel },
	B: { name: B.name, Component: B.VariantFairy },
	C: { name: C.name, Component: C.VariantThreads },
	D: { name: D.name, Component: D.VariantCommandBar },
} as const
type Key = keyof typeof VARIANTS
const KEYS = Object.keys(VARIANTS) as Key[]

export function AgentPresencePrototype() {
	const initial = new URLSearchParams(window.location.search).get('variant') as Key | null
	const [variant, setVariant] = useState<Key>(initial && initial in VARIANTS ? initial : 'A')
	const { Component } = VARIANTS[variant]
	return (
		<div className="canvas-app">
			<Component key={variant} />
			{import.meta.env.DEV && <PrototypeSwitcher current={variant} onChange={setVariant} />}
		</div>
	)
}

function PrototypeSwitcher({ current, onChange }: { current: Key; onChange: (k: Key) => void }) {
	const { status, label, messages } = useAgent()
	const go = (d: number) => {
		const next = KEYS[(KEYS.indexOf(current) + d + KEYS.length) % KEYS.length] as Key
		const url = new URL(window.location.href)
		url.searchParams.set('variant', next)
		window.history.replaceState(null, '', url)
		onChange(next)
	}
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			// Alt+arrows: plain arrows nudge selected shapes in tldraw.
			if (!e.altKey || isTyping(e)) return
			if (e.key === 'ArrowLeft') go(-1)
			if (e.key === 'ArrowRight') go(1)
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	})
	return (
		<div className="ap-switcher">
			<button type="button" onClick={() => go(-1)} title="Previous (Alt+←)">
				‹
			</button>
			<span>
				<b>{current}</b> {VARIANTS[current].name}
			</span>
			<button type="button" onClick={() => go(1)} title="Next (Alt+→)">
				›
			</button>
			<span className="ap-switcher__state">
				agent: {status}
				{label ? ` · ${label}` : ''} · {messages.length} msgs
			</span>
		</div>
	)
}
