import { describe, expect, it } from 'vitest'
import { resolveCanvasBackend } from '../src/backend'

describe('resolveCanvasBackend', () => {
	it('defaults to desktop when CANVAS_BACKEND is unset', () => {
		expect(resolveCanvasBackend(undefined)).toBe('desktop')
	})

	it('defaults to desktop for an empty value', () => {
		expect(resolveCanvasBackend('')).toBe('desktop')
	})

	it('falls back to vite only when explicitly requested', () => {
		expect(resolveCanvasBackend('vite')).toBe('vite')
	})

	it('treats "desktop" explicitly the same as unset', () => {
		expect(resolveCanvasBackend('desktop')).toBe('desktop')
	})

	it('defaults to desktop for an unrecognized value rather than failing silently onto vite', () => {
		expect(resolveCanvasBackend('vit')).toBe('desktop')
		expect(resolveCanvasBackend('VITE')).toBe('desktop')
	})
})
