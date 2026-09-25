import { type CanvasActivity, mentionsAgent, type ShapeRole } from '@tldraw-code/protocol'
import {
	type Editor,
	renderPlaintextFromRichText,
	type TLNoteShape,
	type TLShape,
	type TLShapeId,
} from 'tldraw'
import { roleOf } from './shapeRoles'

/**
 * Tracks what the user did on the canvas since Claude last read it
 * (ADR 0009): shapes added (by role), changed and removed. Changes made
 * while a bridge command runs are Claude's own and are not counted, and
 * question cards are left out entirely (their answers reach Claude through
 * `ask`, and their height updates are noise). It also knows which sticky
 * notes address Claude with the `&agent` tag and which of those Claude has
 * already been told about (ADR 0024).
 */
export class ActivityTracker {
	private readonly added = new Map<TLShapeId, ShapeRole>()
	private readonly changed = new Set<TLShapeId>()
	private removed = 0
	private commandDepth = 0
	private readonly cleanups: (() => void)[]
	private readonly listeners = new Set<() => void>()
	/**
	 * The text of each `&agent` note as Claude last saw it, by push or read.
	 * Notes already on the canvas when the tracker starts (a tab reload) count
	 * as seen: only what the user writes from now on wakes Claude.
	 */
	private handled: Map<TLShapeId, string>
	/**
	 * Notes the user wrote or rewrote here, in this tab, since Claude last heard
	 * of them. Only these can wake Claude: a tagged note that merely exists (left
	 * over from an earlier session, loaded from storage, or synced from another
	 * tab) never does, however the baseline above came to be.
	 */
	private readonly touched = new Set<TLShapeId>()

	constructor(private readonly editor: Editor) {
		this.handled = this.invocations()
		const tracked = (shape: TLShape) => this.commandDepth === 0 && roleOf(shape) !== 'question_card'
		this.cleanups = [
			editor.sideEffects.registerAfterCreateHandler('shape', (shape, source) => {
				if (source === 'user') this.touch(shape)
				if (!tracked(shape)) return
				this.added.set(shape.id, roleOf(shape))
				this.notify()
			}),
			editor.sideEffects.registerAfterChangeHandler('shape', (_prev, next, source) => {
				if (source === 'user') this.touch(next)
				if (!tracked(next)) return
				if (!this.added.has(next.id)) this.changed.add(next.id)
				this.notify()
			}),
			editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
				this.touched.delete(shape.id)
				if (!tracked(shape)) return
				this.changed.delete(shape.id)
				if (!this.added.delete(shape.id)) this.removed++
				this.notify()
			}),
		]
	}

	/** The user wrote to this shape: if it is a note, it may now address Claude. */
	private touch(shape: TLShape): void {
		if (shape.type === 'note' && this.commandDepth === 0) this.touched.add(shape.id)
	}

	/**
	 * Called after every change the user makes (not Claude's own), including
	 * each keystroke in a shape's text. Returns an unsubscribe function.
	 */
	onActivity(listener: () => void): () => void {
		this.listeners.add(listener)
		return () => this.listeners.delete(listener)
	}

	private notify(): void {
		for (const listener of this.listeners) listener()
	}

	/** Run a bridge command's canvas changes without counting them as user activity. */
	asClaude<T>(run: () => T): T {
		this.commandDepth++
		try {
			return run()
		} finally {
			this.commandDepth--
		}
	}

	snapshot(): CanvasActivity {
		const added: CanvasActivity['added'] = {}
		for (const role of this.added.values()) added[role] = (added[role] ?? 0) + 1
		const invoked = this.unhandledInvocations().length
		return {
			added,
			changed: this.changed.size,
			removed: this.removed,
			...(invoked > 0 && { invoked }),
		}
	}

	/** Claude was told about the `&agent` notes there are now: they do not wake it again. */
	markInvocationsHandled(): void {
		this.handled = this.invocations()
		this.touched.clear()
	}

	/** The user's sticky notes addressed to Claude, with their text (Claude's own notes never count). */
	private invocations(): Map<TLShapeId, string> {
		const notes = new Map<TLShapeId, string>()
		for (const shape of this.editor.getCurrentPageShapes()) {
			if (shape.type !== 'note' || roleOf(shape) !== 'sticky_note') continue
			const text = renderPlaintextFromRichText(this.editor, (shape as TLNoteShape).props.richText)
			if (mentionsAgent(text)) notes.set(shape.id, text)
		}
		return notes
	}

	/** Addressed to Claude and written or rewritten by the user since it last heard of them. */
	private unhandledInvocations(): TLShapeId[] {
		return [...this.invocations()]
			.filter(([id, text]) => this.touched.has(id) && this.handled.get(id) !== text)
			.map(([id]) => id)
	}

	/** Claude has seen the canvas: start counting afresh. */
	reset(): void {
		this.added.clear()
		this.changed.clear()
		this.removed = 0
		this.markInvocationsHandled()
	}

	dispose(): void {
		this.listeners.clear()
		for (const cleanup of this.cleanups) cleanup()
	}
}
