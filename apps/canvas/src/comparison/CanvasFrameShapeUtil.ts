import { FrameShapeUtil, type TLFrameShape, type TLShape } from 'tldraw'
import { choiceOf } from './comparisonFrames'

/**
 * The canvas's frames. A collapsed (rejected) comparison frame keeps its
 * diagram (ADR 0021, ADR 0027): the diagram hangs below the title bar,
 * outside the frame's bounds, so tldraw would kick it out to the page, and
 * so into view, when the user moves the frame. A rejected frame gives up no
 * children and takes none in (a shape dropped on it would vanish).
 */
export class CanvasFrameShapeUtil extends FrameShapeUtil {
	override canRemoveChildrenOfType(shape: TLFrameShape, type: TLShape['type']): boolean {
		return !isCollapsed(shape) && super.canRemoveChildrenOfType(shape, type)
	}

	override canReceiveNewChildrenOfType(shape: TLFrameShape, type: TLShape['type']): boolean {
		return !isCollapsed(shape) && super.canReceiveNewChildrenOfType(shape, type)
	}
}

function isCollapsed(shape: TLFrameShape): boolean {
	return choiceOf(shape).choice === 'rejected'
}
