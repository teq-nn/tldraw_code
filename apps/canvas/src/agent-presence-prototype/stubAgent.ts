// PROTOTYPE (throwaway, branch prototype/agent-presence): a scripted stand-in for Claude,
// so the four presence variants can be judged on feel without any real agent plumbing.
import {
	createShapeId,
	type Editor,
	type TLDefaultColorStyle,
	type TLShapeId,
	toRichText,
} from 'tldraw'

export type Point = { x: number; y: number }

export interface ChatMessage {
	id: string
	from: 'user' | 'agent'
	/** `action` = a step the agent took, shown as a log line rather than speech. */
	kind: 'speech' | 'action'
	text: string
	/** Page point the message is "spoken" at. */
	at: Point
	/** Shape the message is about, if any; spatial variants anchor to it. */
	shapeId?: TLShapeId
	threadId: string
	time: number
}

export interface AgentState {
	status: 'idle' | 'thinking' | 'working'
	label: string
	cursor: Point
	focus: TLShapeId[]
	step?: { done: number; total: number }
	messages: ChatMessage[]
}

const COLORS: TLDefaultColorStyle[] = [
	'light-violet',
	'violet',
	'light-blue',
	'blue',
	'yellow',
	'orange',
	'light-green',
	'green',
	'light-red',
	'red',
	'grey',
	'black',
]
const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const findColor = (t: string) =>
	[...COLORS]
		.sort((a, b) => b.length - a.length)
		.find((c) => t.includes(c.replace('-', ' ')) || t.includes(c))

let nextId = 0
const uid = (p: string) => `${p}${++nextId}`

export class StubAgent {
	private state: AgentState = {
		status: 'idle',
		label: '',
		cursor: { x: 0, y: 0 },
		focus: [],
		messages: [],
	}
	private listeners = new Set<() => void>()
	private editor?: Editor
	private task?: { cancelled: boolean; color: TLDefaultColorStyle }
	private thread = uid('t')
	private greeted = false

	attach(editor: Editor) {
		this.editor = editor
		if (this.greeted) return
		this.greeted = true
		const b = editor.getCurrentPageBounds()
		this.set({ cursor: b ? { x: b.maxX + 40, y: b.minY } : { x: 0, y: 0 } })
		setTimeout(
			() =>
				this.say(
					'Hi, I am on the canvas with you. Try "add three options", then say "make them red" or "stop" while I draw. Select a shape and ask "explain this".',
				),
			600,
		)
	}

	subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
	getState = () => this.state

	/** User speaks. `newThread` starts a separate conversation (the threads variant). */
	send(
		text: string,
		opts: { at?: Point; shapeId?: TLShapeId; threadId?: string; newThread?: boolean } = {},
	) {
		if (opts.newThread) this.thread = uid('t')
		else if (opts.threadId) this.thread = opts.threadId
		const shapeId = opts.shapeId ?? this.editor?.getOnlySelectedShapeId() ?? undefined
		const at = opts.at ?? this.centerOf(shapeId) ?? this.state.cursor
		this.push({ from: 'user', kind: 'speech', text, at, shapeId })
		const t = text.toLowerCase()
		if (this.task) this.steer(t, text)
		else void this.run(t, at, shapeId)
	}

	private steer(t: string, raw: string) {
		if (!this.task) return
		const color = findColor(t)
		if (/\b(stop|wait|cancel|hold on|enough)\b/.test(t)) {
			this.task.cancelled = true
			this.say('Stopping after this one. What should I do instead?')
		} else if (color) {
			this.task.color = color
			this.say(`Switching to ${color} for the rest.`)
		} else {
			this.say(`Heard you mid-task: "${raw}". I will fold that in once this step lands.`)
		}
	}

	private async run(t: string, at: Point, shapeId?: TLShapeId) {
		this.set({ status: 'thinking', label: 'Reading the canvas' })
		await this.moveTo(at)
		await sleep(600)
		if (/\b(add|draw|create|make|options?|nodes?|ideas?)\b/.test(t))
			await this.addNodes(t, at, shapeId)
		else if (shapeId || /explain|what|why|\?/.test(t)) await this.explain(shapeId)
		else
			this.say(
				`(stub) Claude would answer "${t}" here. Scripted verbs: "add N options", "explain this", and "stop" / a colour while I work.`,
			)
		this.set({ status: 'idle', label: '', focus: [], step: undefined })
	}

	private async addNodes(t: string, at: Point, shapeId?: TLShapeId) {
		const editor = this.editor
		if (!editor) return
		const count =
			Number(t.match(/\d/)?.[0]) ||
			NUMBERS[Object.keys(NUMBERS).find((w) => t.includes(w)) ?? ''] ||
			3
		const task = { cancelled: false, color: findColor(t) ?? ('violet' as TLDefaultColorStyle) }
		this.task = task
		const anchor = shapeId ? editor.getShapePageBounds(shapeId) : undefined
		const origin = anchor ? { x: anchor.maxX + 80, y: anchor.minY } : { x: at.x + 40, y: at.y }
		this.say(`Adding ${count} options${anchor ? ' next to it' : ' here'}.`)
		let done = 0
		for (let i = 0; i < count && !task.cancelled; i++) {
			this.set({
				status: 'working',
				label: `Drawing option ${i + 1} of ${count}`,
				step: { done, total: count },
			})
			const p = { x: origin.x, y: origin.y + i * 120 }
			await this.moveTo({ x: p.x + 90, y: p.y + 40 })
			const id = createShapeId()
			const label = `Option ${String.fromCharCode(65 + i)}`
			editor.createShape({
				id,
				type: 'geo',
				x: p.x,
				y: p.y,
				meta: { label },
				props: { w: 180, h: 80, color: task.color, fill: 'semi', richText: toRichText(label) },
			})
			this.action(`Drew "${label}"`, id)
			done++
			this.set({ focus: [id], step: { done, total: count } })
			await sleep(1300)
		}
		this.task = undefined
		this.say(
			task.cancelled
				? `Stopped at ${done} of ${count}.`
				: `Done: ${count} options. Which one should I flesh out?`,
		)
	}

	private async explain(shapeId?: TLShapeId) {
		const editor = this.editor
		if (!editor) return
		const shape = shapeId
			? editor.getShape(shapeId)
			: editor.getCurrentPageShapes().find((s) => s.type === 'geo')
		if (!shape) return this.say('There is nothing on the canvas to explain yet.')
		const label = (shape.meta.label as string | undefined) ?? 'this shape'
		this.set({ status: 'working', label: `Looking at "${label}"`, focus: [shape.id] })
		await this.moveTo(this.centerOf(shape.id) ?? this.state.cursor)
		await sleep(900)
		this.say(
			`"${label}": (stub) Claude would explain it in context of what is around it.`,
			shape.id,
		)
	}

	private centerOf(id?: TLShapeId) {
		const b = id && this.editor?.getShapePageBounds(id)
		return b ? { x: b.midX, y: b.midY } : undefined
	}

	private async moveTo(p: Point) {
		// Follow Claude when it wanders out of view (keeps a margin for bubbles and panels).
		const view = this.editor?.getViewportPageBounds()
		const m = view ? Math.min(view.w, view.h) * 0.25 : 0
		if (
			view &&
			(p.x < view.minX + m ||
				p.x > view.maxX - m * 2.2 ||
				p.y < view.minY + m ||
				p.y > view.maxY - m)
		)
			this.editor?.centerOnPoint(p, { animation: { duration: 500 } })
		this.set({ cursor: p })
		await sleep(500)
	}

	private say(text: string, shapeId?: TLShapeId) {
		this.push({ from: 'agent', kind: 'speech', text, at: this.state.cursor, shapeId })
	}
	private action(text: string, shapeId?: TLShapeId) {
		this.push({ from: 'agent', kind: 'action', text, at: this.state.cursor, shapeId })
	}
	private push(m: Omit<ChatMessage, 'id' | 'time' | 'threadId'>) {
		this.set({
			messages: [
				...this.state.messages,
				{ ...m, id: uid('m'), time: Date.now(), threadId: this.thread },
			],
		})
	}
	private set(patch: Partial<AgentState>) {
		this.state = { ...this.state, ...patch }
		for (const l of this.listeners) l()
	}
}

/** One agent for the page, so its history survives switching variants. */
export const agent = new StubAgent()
