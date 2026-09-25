import { QUESTION_CARD_WIDTH } from '../ask/QuestionCardShapeUtil'

/**
 * The compact arrangement of a comparison on the canvas (ADR 0029): its
 * frames wrap into a grid whose block, together with the question card
 * beside it, comes as close to square as the frames allow, instead of one
 * long row. Pure geometry, shared by diagram and prototype comparisons.
 */

/** Space between a comparison's frames and its question card on their left. */
export const CARD_GAP = 80
/** Width kept free left of a comparison's frames for its question card. */
export const QUESTION_CARD_SLOT = QUESTION_CARD_WIDTH + CARD_GAP

export interface Size {
	w: number
	h: number
}

/**
 * How many columns `count` frames of size `cell` (`gap` apart) should use:
 * the number whose block, plus `reservedWidth` beside it, has the aspect
 * ratio closest to square. Wide, flat frames (a left-to-right flow) stack in
 * one column; tall ones stand side by side; square ones wrap into a grid.
 * Ties go to fewer columns.
 */
export function gridColumns(count: number, cell: Size, gap: number, reservedWidth = 0): number {
	let best = 1
	let bestScore = Number.POSITIVE_INFINITY
	for (let columns = 1; columns <= Math.max(1, count); columns++) {
		const rows = Math.ceil(count / columns)
		const width = reservedWidth + columns * cell.w + (columns - 1) * gap
		const height = rows * cell.h + (rows - 1) * gap
		const score = Math.abs(Math.log(width / Math.max(1, height)))
		if (score < bestScore - 1e-9) {
			best = columns
			bestScore = score
		}
	}
	return best
}

/** Offset of frame `index` from the grid's top left corner: rows fill left to right. */
export function gridCell(index: number, columns: number, cell: Size, gap: number) {
	return {
		x: (index % columns) * (cell.w + gap),
		y: Math.floor(index / columns) * (cell.h + gap),
	}
}
