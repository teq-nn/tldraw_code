import { describe, expect, it } from 'vitest'
import { gridCell, gridColumns } from '../src/comparison/arrangement'

// The compact arrangement of a comparison's frames (issue #21, ADR 0029).

describe('gridColumns', () => {
	it('stacks wide, flat frames in one column instead of one long row', () => {
		// The frames of the issue's example: three flow diagrams, about 530 x 180 each.
		expect(gridColumns(3, { w: 530, h: 180 }, 80)).toBe(1)
		expect(gridColumns(2, { w: 530, h: 180 }, 80)).toBe(1)
	})

	it('puts tall, narrow frames side by side', () => {
		expect(gridColumns(3, { w: 200, h: 600 }, 80)).toBe(3)
		expect(gridColumns(2, { w: 200, h: 600 }, 80)).toBe(2)
	})

	it('wraps square frames into a grid about as wide as it is tall', () => {
		expect(gridColumns(3, { w: 400, h: 400 }, 80)).toBe(2)
		expect(gridColumns(4, { w: 400, h: 400 }, 80)).toBe(2)
	})

	it('counts the space reserved beside the frames (for the question card) into the width', () => {
		// Without the reserved slot two squares side by side are wider than tall...
		expect(gridColumns(2, { w: 300, h: 400 }, 80)).toBe(2)
		// ...with a card beside them, stacking them keeps the whole block closer to square.
		expect(gridColumns(2, { w: 300, h: 400 }, 80, 460)).toBe(1)
	})

	it('uses one column for a single frame, and never more columns than frames', () => {
		expect(gridColumns(1, { w: 100, h: 1000 }, 80)).toBe(1)
		expect(gridColumns(2, { w: 10, h: 5000 }, 80)).toBe(2)
	})
})

describe('gridCell', () => {
	it('fills rows left to right, then the next row below', () => {
		const cell = { w: 500, h: 200 }
		expect(gridCell(0, 2, cell, 80)).toEqual({ x: 0, y: 0 })
		expect(gridCell(1, 2, cell, 80)).toEqual({ x: 580, y: 0 })
		expect(gridCell(2, 2, cell, 80)).toEqual({ x: 0, y: 280 })
		expect(gridCell(2, 1, cell, 80)).toEqual({ x: 0, y: 560 })
	})
})
