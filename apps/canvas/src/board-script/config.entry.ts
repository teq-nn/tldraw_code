import {
	type Editor,
	FrameShapeUtil,
	type TLAnyShapeUtilConstructor,
	type TLComponents,
	type TLShape,
} from 'tldraw'
import { QuestionCardShapeUtil } from '../ask/QuestionCardShapeUtil'
import { hideCollapsedContent } from '../comparison/comparisonFrames'
import { PrototypeShapeUtil } from '../prototype/PrototypeShapeUtil'
import { BoardTopPanel } from './BoardTopPanel'

/**
 * The fields of tldraw offline's own `TldrawConfig` (documented in the
 * script workspace's `script-context.d.ts`, not a package this repo depends
 * on) that this entry touches.
 */
interface BoardScriptConfig {
	shapeUtils: TLAnyShapeUtilConstructor[]
	components?: TLComponents
	getShapeVisibility?: (shape: TLShape, editor: Editor) => 'hidden' | 'inherit' | 'visible'
}

/**
 * `config.js`'s default export: registers the same shapes, TopPanel (the
 * bridge pill) and shape-visibility rule as the Vite canvas's `App.tsx`
 * (ticket #16). Everything is imported from the real modules, never copied.
 * Runs once, before the tldraw offline editor mounts.
 */
export default function configureBoard({
	config,
}: {
	config: BoardScriptConfig
}): BoardScriptConfig {
	// Frames show their colour, so a settled comparison's chosen alternative stands out in green (ADR 0021).
	config.shapeUtils.push(
		QuestionCardShapeUtil,
		PrototypeShapeUtil,
		FrameShapeUtil.configure({ showColors: true }),
	)
	config.components = { ...config.components, TopPanel: BoardTopPanel }
	config.getShapeVisibility = hideCollapsedContent
	return config
}
