import { useCallback, useRef, useState } from 'react'
import {
	HTMLContainer,
	type RecordProps,
	Rectangle2d,
	resizeBox,
	ShapeUtil,
	T,
	type TLResizeInfo,
	type TLShape,
	useEditor,
	useValue,
} from 'tldraw'
import {
	PROTOTYPE_ALLOW,
	PROTOTYPE_CSP,
	PROTOTYPE_SANDBOX,
	prototypesDisabled,
	sandboxDocument,
} from './sandbox'
import { registerPrototypeIframe, snapshotPrototype } from './snapshot'

export const PROTOTYPE_FRAME_TYPE = 'prototype-frame' as const

/** Height of the frame's title bar above the prototype's viewport. */
export const PROTOTYPE_HEADER_HEIGHT = 56
const MIN_VIEWPORT = 160

export interface PrototypeFrameProps {
	/** Stable id Claude gave the prototype (`render_prototype`). */
	prototypeId: string
	label: string
	/** One sentence on what sets it apart; '' for none. */
	caption: string
	/** The prototype's HTML, untrusted: only ever shown through {@link sandboxDocument}. */
	html: string
	/** Id of the prototype this one iterates on; '' for none. */
	iterationOf: string
	/** Whole frame: the viewport is `w` x (`h` - header). */
	w: number
	h: number
}

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[PROTOTYPE_FRAME_TYPE]: PrototypeFrameProps
	}
}

export type PrototypeFrameShape = TLShape<typeof PROTOTYPE_FRAME_TYPE>

export function isPrototypeFrame(shape: TLShape | undefined): shape is PrototypeFrameShape {
	return shape?.type === PROTOTYPE_FRAME_TYPE
}

/** The prototype's viewport size in CSS px. */
export function viewportOf(shape: PrototypeFrameShape): { width: number; height: number } {
	return {
		width: Math.round(shape.props.w),
		height: Math.max(0, Math.round(shape.props.h - PROTOTYPE_HEADER_HEIGHT)),
	}
}

/**
 * The prototype frame (CONTEXT.md): a title bar with the label and caption
 * over a sandboxed iframe running Claude's HTML (ADR 0016, ADR 0017). With
 * the select tool idle the prototype is clickable; with any other tool (draw,
 * note, ...) or mid-gesture, pointer events pass through to the canvas, so
 * the user can scribble and stick notes right on it. Drag it by its title bar.
 */
export class PrototypeShapeUtil extends ShapeUtil<PrototypeFrameShape> {
	static override type = PROTOTYPE_FRAME_TYPE
	static override props: RecordProps<PrototypeFrameShape> = {
		prototypeId: T.string,
		label: T.string,
		caption: T.string,
		html: T.string,
		iterationOf: T.string,
		w: T.number,
		h: T.number,
	}

	override getDefaultProps(): PrototypeFrameProps {
		return {
			prototypeId: '',
			label: '',
			caption: '',
			html: '',
			iterationOf: '',
			w: 480,
			h: 360 + PROTOTYPE_HEADER_HEIGHT,
		}
	}

	override canEdit() {
		return false
	}

	override hideRotateHandle() {
		return true
	}

	override getGeometry(shape: PrototypeFrameShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override onResize(shape: PrototypeFrameShape, info: TLResizeInfo<PrototypeFrameShape>) {
		return resizeBox(shape, info, {
			minWidth: MIN_VIEWPORT,
			minHeight: MIN_VIEWPORT + PROTOTYPE_HEADER_HEIGHT,
		})
	}

	override component(shape: PrototypeFrameShape) {
		return <PrototypeFrame shape={shape} />
	}

	/** Exports and `read_canvas` screenshots show a snapshot of the live prototype. */
	override async toSvg(shape: PrototypeFrameShape) {
		const { width, height } = viewportOf(shape)
		const snapshot = await snapshotPrototype(shape.id, width, height)
		return <PrototypeFrameSvg shape={shape} snapshot={snapshot} />
	}

	override getIndicatorPath(shape: PrototypeFrameShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 10)
		return path
	}
}

function PrototypeFrame({ shape }: { shape: PrototypeFrameShape }) {
	const editor = useEditor()
	const { label, caption, html, iterationOf, w, h } = shape.props
	// Clickable only while nothing else is going on; otherwise the canvas gets the pointer.
	const interactive = useValue('prototype interactive', () => editor.isIn('select.idle'), [editor])
	// A prototype that navigates away from its document is put back (ADR 0016).
	const [generation, setGeneration] = useState(0)
	const loads = useRef({ key: '', count: 0 })
	const ref = useCallback(
		(iframe: HTMLIFrameElement | null) => registerPrototypeIframe(shape.id, iframe),
		[shape.id],
	)
	const viewportHeight = Math.max(0, h - PROTOTYPE_HEADER_HEIGHT)
	const disabled = prototypesDisabled()
	// A fresh iframe for new HTML and after a navigation; its first load is its own document.
	const frameKey = `${generation}:${hashString(html)}`

	return (
		<HTMLContainer className="prototype-frame" style={{ width: w, height: h }}>
			<div className="prototype-frame__header">
				<div className="prototype-frame__title">
					<span className="prototype-frame__kind">Prototype</span>
					<span className="prototype-frame__label">{label}</span>
					{iterationOf && (
						<span className="prototype-frame__iteration">iterates on {iterationOf}</span>
					)}
				</div>
				{caption && (
					<div className="prototype-frame__caption" title={caption}>
						{caption}
					</div>
				)}
			</div>
			{disabled ? (
				<div className="prototype-frame__placeholder" style={{ height: viewportHeight }}>
					Prototypes are off (?prototypes=off)
				</div>
			) : (
				<iframe
					key={frameKey}
					ref={ref}
					className="prototype-frame__iframe"
					data-testid="prototype-iframe"
					title={label}
					srcDoc={sandboxDocument(html)}
					sandbox={PROTOTYPE_SANDBOX}
					allow={PROTOTYPE_ALLOW}
					// CSP Embedded Enforcement (Chromium): the same policy, required by the embedder.
					{...{ csp: PROTOTYPE_CSP }}
					referrerPolicy="no-referrer"
					loading="eager"
					draggable={false}
					tabIndex={interactive ? 0 : -1}
					onLoad={() => {
						if (loads.current.key !== frameKey) loads.current = { key: frameKey, count: 0 }
						loads.current.count++
						if (loads.current.count > 1) setGeneration((g) => g + 1)
					}}
					style={{
						width: w,
						height: viewportHeight,
						pointerEvents: interactive ? 'auto' : 'none',
					}}
				/>
			)}
		</HTMLContainer>
	)
}

/** Short, stable fingerprint of a string (djb2), for keying the iframe by its HTML. */
function hashString(text: string): string {
	let hash = 5381
	for (let i = 0; i < text.length; i++) hash = (hash * 33) ^ text.charCodeAt(i)
	return (hash >>> 0).toString(36)
}

const SVG_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

function PrototypeFrameSvg({
	shape,
	snapshot,
}: {
	shape: PrototypeFrameShape
	snapshot: string | undefined
}) {
	const { w, h, label, caption, iterationOf } = shape.props
	const viewportHeight = Math.max(0, h - PROTOTYPE_HEADER_HEIGHT)
	const title = iterationOf ? `${label} · iterates on ${iterationOf}` : label
	return (
		<g fontFamily={SVG_FONT}>
			<rect width={w} height={h} rx={10} fill="#f4f1fb" stroke="#8a63d2" strokeWidth={2} />
			<text x={12} y={22} fontSize={14} fontWeight={600} fill="#1d2130">
				{`Prototype · ${title}`}
			</text>
			{caption && (
				<text x={12} y={42} fontSize={12} fill="#5b6070">
					{caption.length > 90 ? `${caption.slice(0, 89)}…` : caption}
				</text>
			)}
			{snapshot ? (
				<image
					href={snapshot}
					x={0}
					y={PROTOTYPE_HEADER_HEIGHT}
					width={w}
					height={viewportHeight}
					preserveAspectRatio="none"
				/>
			) : (
				<>
					<rect
						x={0}
						y={PROTOTYPE_HEADER_HEIGHT}
						width={w}
						height={viewportHeight}
						fill="#ffffff"
					/>
					<text
						x={w / 2}
						y={PROTOTYPE_HEADER_HEIGHT + viewportHeight / 2}
						fontSize={13}
						fill="#5b6070"
						textAnchor="middle"
					>
						Live HTML prototype (no snapshot available)
					</text>
				</>
			)}
		</g>
	)
}
