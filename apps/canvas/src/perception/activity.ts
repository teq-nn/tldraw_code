import type { CanvasActivity, ShapeRole } from '@tldraw-code/protocol'
import type { Editor, TLShape, TLShapeId } from 'tldraw'
import { roleOf } from './shapeRoles'

/**
 * Tracks what the user did on the canvas since Claude last read it
 * (ADR 0009): shapes added (by role), changed and removed. Changes made
 * while a bridge command runs are Claude's own and are not counted, and
 * question cards are left out entirely (their answers reach Claude through
 * `ask`, and their height updates are noise).
 */
export class ActivityTracker {
	private readonly added = new Map<TLShapeId, ShapeRole>()
	private readonly changed = new Set<TLShapeId>()
	private removed = 0
	private commandDepth = 0
	private readonly cleanups: (() => void)[]

	constructor(editor: Editor) {
		const tracked = (shape: TLShape) => this.commandDepth === 0 && roleOf(shape) !== 'question_card'
		this.cleanups = [
			editor.sideEffects.registerAfterCreateHandler('shape', (shape) => {
				if (tracked(shape)) this.added.set(shape.id, roleOf(shape))
			}),
			editor.sideEffects.registerAfterChangeHandler('shape', (_prev, next) => {
				if (tracked(next) && !this.added.has(next.id)) this.changed.add(next.id)
			}),
			editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
				if (!tracked(shape)) return
				this.changed.delete(shape.id)
				if (!this.added.delete(shape.id)) this.removed++
			}),
		]
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
		return { added, changed: this.changed.size, removed: this.removed }
	}

	/** Claude has seen the canvas: start counting afresh. */
	reset(): void {
		this.added.clear()
		this.changed.clear()
		this.removed = 0
	}

	dispose(): void {
		for (const cleanup of this.cleanups) cleanup()
	}
}
