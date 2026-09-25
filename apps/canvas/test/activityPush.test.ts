// @vitest-environment jsdom
import type { CanvasActivity } from '@tldraw-code/protocol'
import { createShapeId, type Editor, type TLNoteShape, type TLShapeId, toRichText } from 'tldraw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCommandHandlers } from '../src/bridge/commandHandlers'
import { ActivityTracker } from '../src/perception/activity'
import { pushActivityWhenQuiet } from '../src/perception/activityPush'
import { createTestEditor } from './createTestEditor'

// The push side of perception (ADR 0024): the test plays the user, fake timers
// play the pause, `send` records what would go over the bridge.

const QUIET = 1000

let editor: Editor
let activity: ActivityTracker
let sent: CanvasActivity[]
let stop: () => void

beforeEach(() => {
	vi.useFakeTimers()
	editor = createTestEditor()
	activity = new ActivityTracker(editor)
	sent = []
	stop = pushActivityWhenQuiet(editor, activity, (digest) => sent.push(digest), QUIET)
})

afterEach(() => {
	stop()
	activity.dispose()
	editor.dispose()
	vi.useRealTimers()
})

function addNote(text: string) {
	const id = createShapeId()
	editor.createShape<TLNoteShape>({
		id,
		type: 'note',
		x: 0,
		y: 0,
		props: { richText: toRichText(text) },
	})
	return id
}

describe('pushing canvas activity', () => {
	it('sends the digest once the user pauses', () => {
		addNote('Use DuckDB &agent')
		vi.advanceTimersByTime(QUIET - 1)
		expect(sent).toEqual([])
		vi.advanceTimersByTime(1)
		expect(sent).toEqual([{ added: { sticky_note: 1 }, changed: 0, removed: 0, invoked: 1 }])
	})

	it('restarts the quiet period on every change', () => {
		const id = addNote('Use &agent')
		vi.advanceTimersByTime(QUIET - 100)
		editor.updateShape<TLNoteShape>({
			id,
			type: 'note',
			props: { richText: toRichText('Use DuckDB &agent') },
		})
		vi.advanceTimersByTime(QUIET - 100)
		expect(sent).toEqual([])
		vi.advanceTimersByTime(100)
		expect(sent).toHaveLength(1)
	})

	it('waits while the user is still typing into a shape', () => {
		const id = addNote('Use &agent')
		editor.setEditingShape(id)
		vi.advanceTimersByTime(QUIET * 3)
		expect(sent).toEqual([])
		editor.setEditingShape(null)
		vi.advanceTimersByTime(QUIET)
		expect(sent).toHaveLength(1)
	})

	it("does not push Claude's own changes", async () => {
		const handlers = createCommandHandlers(editor, { activity })
		await handlers['smoke.create_shape']({ text: 'hello' })
		vi.advanceTimersByTime(QUIET * 2)
		expect(sent).toEqual([])
	})

	it('sends nothing when Claude read the canvas during the pause', async () => {
		const handlers = createCommandHandlers(editor, {
			activity,
			capture: async () => ({ mimeType: 'image/png', data: 'AAAA', width: 1, height: 1 }),
		})
		addNote('Use DuckDB &agent')
		await handlers['canvas.read']({ region: 'all', screenshot: false })
		vi.advanceTimersByTime(QUIET)
		expect(sent).toEqual([])
	})

	it('stops when disposed', () => {
		stop()
		addNote('Use DuckDB &agent')
		vi.advanceTimersByTime(QUIET)
		expect(sent).toEqual([])
	})

	describe('the &agent tag', () => {
		function editNote(id: TLShapeId, text: string) {
			editor.updateShape<TLNoteShape>({ id, type: 'note', props: { richText: toRichText(text) } })
		}

		it('lets notes without the tag pass unpushed', () => {
			addNote('Use DuckDB')
			vi.advanceTimersByTime(QUIET)
			expect(sent).toEqual([])
		})

		it('matches the tag anywhere in the text, in any case, but not inside another word', () => {
			addNote('&agentic tools')
			addNote('mail me&agent')
			vi.advanceTimersByTime(QUIET)
			expect(sent).toEqual([])
			addNote('Please\nlook at this &AGENT.')
			vi.advanceTimersByTime(QUIET)
			expect(sent).toHaveLength(1)
		})

		it('pushes when the user tags a note that was already there', () => {
			const id = addNote('Use DuckDB')
			vi.advanceTimersByTime(QUIET)
			editNote(id, 'Use DuckDB &agent')
			vi.advanceTimersByTime(QUIET)
			expect(sent).toEqual([{ added: { sticky_note: 1 }, changed: 0, removed: 0, invoked: 1 }])
		})

		it('does not push a tagged note twice, whatever else the user does', () => {
			addNote('Use DuckDB &agent')
			vi.advanceTimersByTime(QUIET)
			expect(sent).toHaveLength(1)
			addNote('just a thought')
			vi.advanceTimersByTime(QUIET)
			expect(sent).toHaveLength(1)
		})

		it('does not push a tagged note that was already on the canvas when the tracker started', () => {
			addNote('Use DuckDB &agent')
			// a tab reload builds a fresh tracker over the persisted canvas
			stop()
			activity.dispose()
			activity = new ActivityTracker(editor)
			stop = pushActivityWhenQuiet(editor, activity, (digest) => sent.push(digest), QUIET)
			addNote('just a thought')
			vi.advanceTimersByTime(QUIET)
			expect(sent).toEqual([])
		})

		it('pushes again when the user rewrites a tagged note', () => {
			const id = addNote('Use DuckDB &agent')
			vi.advanceTimersByTime(QUIET)
			editNote(id, 'Use SQLite &agent')
			vi.advanceTimersByTime(QUIET)
			expect(sent).toHaveLength(2)
		})

		it('does not push when a tagged note is deleted', () => {
			const id = addNote('Use DuckDB &agent')
			vi.advanceTimersByTime(QUIET)
			editor.deleteShape(id)
			vi.advanceTimersByTime(QUIET)
			expect(sent).toHaveLength(1)
		})

		it('counts a tagged note as read once Claude read the canvas', async () => {
			const handlers = createCommandHandlers(editor, {
				activity,
				capture: async () => ({ mimeType: 'image/png', data: 'AAAA', width: 1, height: 1 }),
			})
			addNote('Use DuckDB &agent')
			await handlers['canvas.read']({ region: 'all', screenshot: false })
			addNote('just a thought')
			vi.advanceTimersByTime(QUIET)
			expect(sent).toEqual([])
		})

		it('reports the tagged notes in the digest a tool result carries', async () => {
			const handlers = createCommandHandlers(editor, { activity })
			addNote('Use DuckDB &agent')
			addNote('Use SQLite &agent')
			expect(await handlers['canvas.activity']({})).toMatchObject({ invoked: 2 })
		})
	})
})
