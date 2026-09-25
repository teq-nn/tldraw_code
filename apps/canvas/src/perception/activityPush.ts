import type { CanvasActivity } from '@tldraw-code/protocol'
import type { Editor } from 'tldraw'
import type { ActivityTracker } from './activity'

/** How long the user has to pause before their activity is pushed to Claude (ADR 0024). */
export const ACTIVITY_QUIET_MS = 2500

/**
 * Report the user's activity once they pause (ADR 0024): every change
 * restarts a quiet period, and when it ends the digest since Claude's last
 * read goes to `send`, but only if a sticky note addresses Claude with the
 * `&agent` tag and Claude has not been told about it yet: everything else
 * the user does is left for the next tool result or `read_canvas`. While the
 * user is still typing into a shape the push waits for another quiet period,
 * so Claude does not read half a note.
 * Returns a function that stops reporting.
 */
export function pushActivityWhenQuiet(
	editor: Editor,
	activity: ActivityTracker,
	send: (activity: CanvasActivity) => void,
	quietMs = ACTIVITY_QUIET_MS,
): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined
	const schedule = () => {
		clearTimeout(timer)
		timer = setTimeout(fire, quietMs)
	}
	const fire = () => {
		timer = undefined
		if (editor.getEditingShapeId() !== null) {
			schedule()
			return
		}
		const snapshot = activity.snapshot()
		if (!snapshot.invoked) return
		activity.markInvocationsHandled()
		send(snapshot)
	}
	const stop = activity.onActivity(schedule)
	return () => {
		stop()
		clearTimeout(timer)
	}
}
