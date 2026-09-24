import { type CanvasScreenshot, MAX_SCREENSHOT_EDGE } from '@tldraw-code/protocol'
import type { Box, Editor, TLShapeId } from 'tldraw'

/** Renders the given shapes, clipped to a page box, as an image. Injectable for tests. */
export type CaptureScreenshot = (
	editor: Editor,
	shapeIds: TLShapeId[],
	bounds: Box,
) => Promise<CanvasScreenshot>

/**
 * Screenshot through tldraw's own export (ADR 0008): a PNG of exactly the
 * region, light mode, on the page background, scaled down so the longer edge
 * is at most {@link MAX_SCREENSHOT_EDGE} px (about what a vision model reads
 * without downscaling it again). Needs a real browser; jsdom has no canvas.
 */
export const captureScreenshot: CaptureScreenshot = async (editor, shapeIds, bounds) => {
	const scale = Math.min(1, MAX_SCREENSHOT_EDGE / Math.max(bounds.w, bounds.h))
	const { blob, width, height } = await editor.toImage(shapeIds, {
		format: 'png',
		bounds,
		scale,
		pixelRatio: 1,
		padding: 0,
		background: true,
		darkMode: false,
	})
	return {
		mimeType: 'image/png',
		data: toBase64(new Uint8Array(await blob.arrayBuffer())),
		width: Math.max(1, Math.round(width)),
		height: Math.max(1, Math.round(height)),
	}
}

function toBase64(bytes: Uint8Array): string {
	let binary = ''
	const chunk = 0x8000
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
	}
	return btoa(binary)
}
