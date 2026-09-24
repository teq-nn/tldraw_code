// @vitest-environment jsdom
import {
	type CanvasCommandPayload,
	type CanvasShape,
	DEFAULT_PROTOTYPE_HEIGHT,
	DEFAULT_PROTOTYPE_WIDTH,
} from '@tldraw-code/protocol'
import { createShapeId, type Editor, type TLNoteShape, type TLShapeId, toRichText } from 'tldraw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCommandHandlers } from '../src/bridge/commandHandlers'
import { nodeShapeId } from '../src/graph/renderGraph'
import { ActivityTracker } from '../src/perception/activity'
import {
	PROTOTYPE_HEADER_HEIGHT,
	type PrototypeFrameShape,
} from '../src/prototype/PrototypeShapeUtil'
import { PROTOTYPE_GAP, prototypeShapeId } from '../src/prototype/renderPrototype'
import {
	PROTOTYPE_CSP,
	PROTOTYPE_SANDBOX,
	prototypesDisabled,
	sandboxDocument,
} from '../src/prototype/sandbox'
import { createTestEditor } from './createTestEditor'

let editor: Editor
let activity: ActivityTracker
let handlers: ReturnType<typeof createCommandHandlers>

beforeEach(() => {
	editor = createTestEditor()
	activity = new ActivityTracker(editor)
	handlers = createCommandHandlers(editor, {
		activity,
		capture: async () => {
			throw new Error('no screenshots here')
		},
	})
})

afterEach(() => {
	activity.dispose()
	editor.dispose()
})

const loginHtml =
	'<!doctype html><html><body><form><input name="email"><button>Sign in</button></form></body></html>'

type Payload = CanvasCommandPayload<'prototype.render'>

function render(payload: Partial<Payload> & Pick<Payload, 'id'>) {
	return handlers['prototype.render']({ label: payload.id, html: loginHtml, ...payload })
}

function frame(id: string): PrototypeFrameShape {
	const shape = editor.getShape<PrototypeFrameShape>(prototypeShapeId(id))
	if (!shape) throw new Error(`no prototype ${id}`)
	return shape
}

function pageBounds(id: TLShapeId) {
	const box = editor.getShapePageBounds(id)
	if (!box) throw new Error(`no shape ${id}`)
	return box
}

function addNote(text: string, x: number, y: number): TLShapeId {
	const id = createShapeId()
	editor.createShape<TLNoteShape>({ id, type: 'note', x, y, props: { richText: toRichText(text) } })
	return id
}

async function read(): Promise<CanvasShape[]> {
	return (await handlers['canvas.read']({ region: 'all', screenshot: false })).shapes
}

describe('prototype.render', () => {
	it('shows the HTML in a prototype frame with its label, caption and default viewport', async () => {
		const result = await render({ id: 'login', label: 'Login', caption: 'One form, no tabs.' })

		const shape = frame('login')
		expect(shape.props).toMatchObject({
			prototypeId: 'login',
			label: 'Login',
			caption: 'One form, no tabs.',
			html: loginHtml,
			iterationOf: '',
			w: DEFAULT_PROTOTYPE_WIDTH,
			h: DEFAULT_PROTOTYPE_HEIGHT + PROTOTYPE_HEADER_HEIGHT,
		})
		expect(result).toMatchObject({
			shapeId: shape.id,
			created: true,
			width: DEFAULT_PROTOTYPE_WIDTH,
			height: DEFAULT_PROTOTYPE_HEIGHT,
		})
		expect(result.bounds.w).toBe(DEFAULT_PROTOTYPE_WIDTH)
		// Claude's own shape: not counted as user activity.
		expect(activity.snapshot().added).toEqual({})
	})

	it('replaces the HTML in place on a second render with the same id, keeping position and size', async () => {
		await render({ id: 'login', width: 640, height: 400 })
		editor.updateShape({ id: prototypeShapeId('login'), type: 'prototype-frame', x: 900, y: -50 })

		const result = await render({ id: 'login', html: '<p>v2</p>', label: 'Login again' })

		expect(result.created).toBe(false)
		expect(frame('login')).toMatchObject({
			x: 900,
			y: -50,
			props: { html: '<p>v2</p>', label: 'Login again', w: 640, h: 400 + PROTOTYPE_HEADER_HEIGHT },
		})
		expect(editor.getCurrentPageShapes()).toHaveLength(1)
	})

	it('places a new prototype to the right of the page content', async () => {
		await handlers['graph.render']({
			nodes: [{ id: 'ui', title: 'Login UI', status: 'open' }],
			edges: [],
			frontier: ['ui'],
		})
		await render({ id: 'login' })

		const graph = pageBounds(nodeShapeId('ui'))
		const prototype = pageBounds(prototypeShapeId('login'))
		expect(prototype.minX).toBeGreaterThan(graph.maxX)
		expect(prototype.minY).toBe(graph.minY)
	})

	it('puts a new iteration right next to the prototype it iterates on, top-aligned', async () => {
		await render({ id: 'login' })
		const result = await render({ id: 'login-v2', label: 'Login v2', iterationOf: 'login' })

		const source = pageBounds(prototypeShapeId('login'))
		const iteration = pageBounds(prototypeShapeId('login-v2'))
		expect(iteration.minX).toBe(source.maxX + PROTOTYPE_GAP)
		expect(iteration.minY).toBe(source.minY)
		expect(result.iterationOfShapeId).toBe(prototypeShapeId('login'))
		expect(frame('login-v2').props.iterationOf).toBe('login')
		// The original stays as it was.
		expect(frame('login').props.html).toBe(loginHtml)
	})

	it("slides an iteration past the user's notes sticking out of the prototype, and past other shapes", async () => {
		await render({ id: 'login' })
		const source = pageBounds(prototypeShapeId('login'))
		const note = addNote('Bigger button', source.maxX - 60, source.y + 100)
		const noteBounds = pageBounds(note)

		await render({ id: 'login-v2', iterationOf: 'login' })

		const iteration = pageBounds(prototypeShapeId('login-v2'))
		expect(iteration.minX).toBeGreaterThanOrEqual(noteBounds.maxX + PROTOTYPE_GAP)
		expect(iteration.collides(noteBounds)).toBe(false)

		await render({ id: 'login-v3', iterationOf: 'login' })
		const third = pageBounds(prototypeShapeId('login-v3'))
		expect(third.collides(iteration)).toBe(false)
		expect(third.minX).toBeGreaterThan(iteration.maxX)
	})

	it('refuses to iterate on a prototype that is not on the canvas, naming the ones that are', async () => {
		await render({ id: 'login' })
		await expect(async () => render({ id: 'x', iterationOf: 'signup' })).rejects.toThrow(
			/no prototype "signup".*"login"/,
		)
		expect(editor.getShape(prototypeShapeId('x'))).toBeUndefined()
	})

	it('is one undo step', async () => {
		editor.markHistoryStoppingPoint('before')
		await render({ id: 'login' })
		editor.undo()
		expect(editor.getCurrentPageShapes()).toHaveLength(0)
	})
})

describe('canvas.read of prototypes', () => {
	it('names the prototype frame and its iteration link', async () => {
		await render({ id: 'login', label: 'Login', caption: 'Plain form.' })
		await render({ id: 'login-v2', label: 'Login v2', iterationOf: 'login' })

		const shapes = await read()
		expect(shapes.find((s) => s.id === prototypeShapeId('login'))).toMatchObject({
			role: 'prototype_frame',
			owner: 'claude',
			type: 'prototype-frame',
			text: 'Login\nPlain form.',
			prototype: { id: 'login', label: 'Login', width: 480, height: 360 },
		})
		expect(shapes.find((s) => s.id === prototypeShapeId('login-v2'))?.prototype).toEqual({
			id: 'login-v2',
			label: 'Login v2',
			iterationOf: 'login',
			width: 480,
			height: 360,
		})
	})

	it('anchors a sticky note on a prototype to it, with its position inside the prototype', async () => {
		await render({ id: 'login', label: 'Login' })
		const box = pageBounds(prototypeShapeId('login'))
		const note = addNote('Make this bigger', box.x + 40, box.y + PROTOTYPE_HEADER_HEIGHT + 100)
		const noteBounds = pageBounds(note)

		const described = (await read()).find((s) => s.id === note)
		expect(described?.anchor).toEqual({
			shapeId: prototypeShapeId('login'),
			role: 'prototype_frame',
			relation: 'on',
			label: 'Login',
			inPrototype: {
				x: 40,
				y: 100,
				w: Math.round(noteBounds.w),
				h: Math.round(noteBounds.h),
			},
		})
	})

	it('assigns each annotation to the prototype it is on, when two stand side by side', async () => {
		await render({ id: 'login', label: 'Login' })
		await render({ id: 'login-v2', label: 'Login v2', iterationOf: 'login' })
		const first = pageBounds(prototypeShapeId('login'))
		const second = pageBounds(prototypeShapeId('login-v2'))
		const onFirst = addNote('Too plain', first.x + 20, first.y + 120)
		const onSecond = addNote('Better', second.x + 200, second.y + 150)

		const shapes = await read()
		expect(shapes.find((s) => s.id === onFirst)?.anchor?.label).toBe('Login')
		expect(shapes.find((s) => s.id === onSecond)?.anchor).toMatchObject({
			label: 'Login v2',
			inPrototype: { x: 200, y: 150 - PROTOTYPE_HEADER_HEIGHT },
		})
	})

	it('anchors a note next to a prototype without a position inside it', async () => {
		await render({ id: 'login', label: 'Login' })
		const box = pageBounds(prototypeShapeId('login'))
		const note = addNote('Try tabs', box.maxX + 40, box.y + 80)

		const anchor = (await read()).find((s) => s.id === note)?.anchor
		expect(anchor).toMatchObject({ role: 'prototype_frame', relation: 'next_to', label: 'Login' })
		expect(anchor?.inPrototype).toBeUndefined()
	})

	it("counts the user's notes on a prototype as canvas activity", async () => {
		await render({ id: 'login' })
		const box = pageBounds(prototypeShapeId('login'))
		addNote('Hm', box.x + 10, box.y + 80)
		expect(activity.snapshot().added).toEqual({ sticky_note: 1 })
	})
})

describe('prototype sandbox', () => {
	it('runs scripts with an opaque origin: never same-origin, top navigation, pop-ups or modals', () => {
		const tokens = PROTOTYPE_SANDBOX.split(' ')
		expect(tokens).toEqual(['allow-scripts', 'allow-forms'])
		expect(tokens).not.toContain('allow-same-origin')
	})

	it('puts the CSP before any of the prototype markup, in standards mode', () => {
		const doc = sandboxDocument(
			'<!DOCTYPE html>\n<html><head><script>fetch("x")</script></head></html>',
		)
		expect(doc.startsWith('<!doctype html>\n<meta http-equiv="Content-Security-Policy"')).toBe(true)
		expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('fetch("x")'))
		expect(doc.match(/<!doctype/gi)).toHaveLength(1)
	})

	it('allows no network, forms, frames or workers, and inline code only', () => {
		const directives = Object.fromEntries(
			PROTOTYPE_CSP.split('; ').map((d) => {
				const [name, ...values] = d.split(' ')
				return [name, values.join(' ')]
			}),
		)
		expect(directives).toMatchObject({
			'default-src': "'none'",
			'script-src': "'unsafe-inline'",
			'connect-src': "'none'",
			'form-action': "'none'",
			'frame-src': "'none'",
			'worker-src': "'none'",
			'base-uri': "'none'",
			'img-src': 'data: blob:',
		})
	})

	it('can be switched off with ?prototypes=off', () => {
		expect(prototypesDisabled('?prototypes=off')).toBe(true)
		expect(prototypesDisabled('?x=1')).toBe(false)
	})
})
