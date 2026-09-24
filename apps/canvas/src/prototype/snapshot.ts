import type { TLShapeId } from 'tldraw'
import { SNAPSHOT_MESSAGE } from './sandbox'

/**
 * Screenshots of live prototypes (ADR 0017). A prototype runs in a
 * cross-origin (opaque) iframe, so tldraw's export cannot see into it. Instead
 * the canvas asks the prototype for its current markup over `postMessage` and
 * rasterises that as an SVG image: an SVG loaded as an image runs no scripts
 * and loads nothing from the network, and the markup never enters the
 * canvas's own DOM.
 */

/** Longest markup accepted from a prototype. */
const MAX_MARKUP_LENGTH = 2_000_000
const DEFAULT_TIMEOUT_MS = 1500
/** Pixel density of the rasterised snapshot. */
const SNAPSHOT_PIXEL_RATIO = 2

const frames = new Map<TLShapeId, HTMLIFrameElement>()

/** Called by the prototype frame component when its iframe mounts (element) or unmounts (null). */
export function registerPrototypeIframe(
	shapeId: TLShapeId,
	iframe: HTMLIFrameElement | null,
): void {
	if (iframe) frames.set(shapeId, iframe)
	else frames.delete(shapeId)
}

/**
 * A PNG data URL of what the prototype currently shows, or undefined when the
 * prototype is not mounted, does not answer in time or cannot be rendered.
 */
export async function snapshotPrototype(
	shapeId: TLShapeId,
	width: number,
	height: number,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string | undefined> {
	const iframe = frames.get(shapeId)
	if (!iframe?.contentWindow) return undefined
	try {
		const markup = await requestMarkup(iframe, timeoutMs)
		return markup ? await rasterise(markup, width, height) : undefined
	} catch {
		return undefined
	}
}

function requestMarkup(iframe: HTMLIFrameElement, timeoutMs: number): Promise<string | undefined> {
	const target = iframe.contentWindow
	if (!target) return Promise.resolve(undefined)
	const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
	return new Promise((resolve) => {
		const done = (markup: string | undefined) => {
			clearTimeout(timer)
			window.removeEventListener('message', onMessage)
			resolve(markup)
		}
		const onMessage = (event: MessageEvent) => {
			// Only this prototype's window, only a well-formed reply to this request.
			if (event.source !== target) return
			const data = event.data as { type?: unknown; nonce?: unknown; markup?: unknown } | null
			if (!data || data.type !== SNAPSHOT_MESSAGE || data.nonce !== nonce) return
			const markup = data.markup
			done(typeof markup === 'string' && markup.length <= MAX_MARKUP_LENGTH ? markup : undefined)
		}
		const timer = setTimeout(() => done(undefined), timeoutMs)
		window.addEventListener('message', onMessage)
		// The prototype's origin is opaque, so '*' is the only target that reaches it;
		// the request carries nothing but a nonce.
		target.postMessage({ type: SNAPSHOT_MESSAGE, nonce }, '*')
	})
}

/** Render XHTML markup at the given CSS size into a PNG data URL, via an SVG image. */
async function rasterise(markup: string, width: number, height: number): Promise<string> {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
		`<foreignObject x="0" y="0" width="${width}" height="${height}">${markup}</foreignObject></svg>`
	const image = new Image()
	image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
	await image.decode()
	const canvas = document.createElement('canvas')
	canvas.width = Math.round(width * SNAPSHOT_PIXEL_RATIO)
	canvas.height = Math.round(height * SNAPSHOT_PIXEL_RATIO)
	const context = canvas.getContext('2d')
	if (!context) throw new Error('no 2d context')
	context.fillStyle = '#ffffff'
	context.fillRect(0, 0, canvas.width, canvas.height)
	context.scale(SNAPSHOT_PIXEL_RATIO, SNAPSHOT_PIXEL_RATIO)
	context.drawImage(image, 0, 0, width, height)
	return canvas.toDataURL('image/png')
}
