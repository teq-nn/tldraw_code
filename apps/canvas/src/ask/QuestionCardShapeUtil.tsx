import { KEEP_GRILLING_LABEL } from '@tldraw-code/protocol'
import { useLayoutEffect, useRef } from 'react'
import {
	type Editor,
	HTMLContainer,
	type RecordProps,
	Rectangle2d,
	ShapeUtil,
	T,
	type TLShape,
	useEditor,
} from 'tldraw'

export const QUESTION_CARD_TYPE = 'question-card' as const

export type QuestionAnswerKind = 'none' | 'option' | 'keep_grilling' | 'note'

export interface QuestionCardProps {
	/** Correlates the card with the `ask` call waiting for it (ADR 0006). */
	askId: string
	question: string
	options: string[]
	/** Index of Claude's recommendation in `options`. */
	recommendation: number
	w: number
	h: number
	/** How the user answered; 'none' while the card waits. */
	answerKind: QuestionAnswerKind
	/** Chosen option index when `answerKind` is 'option', else -1. */
	answerOption: number
	/** Text of the sticky note when `answerKind` is 'note', else ''. */
	answerText: string
}

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[QUESTION_CARD_TYPE]: QuestionCardProps
	}
}

export type QuestionCardShape = TLShape<typeof QUESTION_CARD_TYPE>

export const QUESTION_CARD_WIDTH = 380

/** Rough height of a card before the browser has measured it (tests and first frame). */
export function estimateCardHeight(question: string, optionCount: number): number {
	const charsPerLine = 30
	const questionLines = Math.max(1, Math.ceil(question.length / charsPerLine))
	const header = 34
	const questionBlock = questionLines * 28 + 16
	const buttons = (optionCount + 1) * 48
	const hint = 36
	return header + questionBlock + buttons + hint + 32
}

/**
 * The question card (CONTEXT.md): one short question, 2 to 4 option buttons
 * with Claude's recommendation marked, and "Keep grilling". A click only
 * records the answer in the card's props; `watchQuestionCards` reports it to
 * the MCP server, so the shape knows nothing about the bridge.
 */
export class QuestionCardShapeUtil extends ShapeUtil<QuestionCardShape> {
	static override type = QUESTION_CARD_TYPE
	static override props: RecordProps<QuestionCardShape> = {
		askId: T.string,
		question: T.string,
		options: T.arrayOf(T.string),
		recommendation: T.number,
		w: T.number,
		h: T.number,
		answerKind: T.literalEnum('none', 'option', 'keep_grilling', 'note'),
		answerOption: T.number,
		answerText: T.string,
	}

	override getDefaultProps(): QuestionCardProps {
		return {
			askId: '',
			question: '',
			options: [],
			recommendation: 0,
			w: QUESTION_CARD_WIDTH,
			h: 200,
			answerKind: 'none',
			answerOption: -1,
			answerText: '',
		}
	}

	override canResize() {
		return false
	}

	override hideResizeHandles() {
		return true
	}

	override hideRotateHandle() {
		return true
	}

	override canEdit() {
		return false
	}

	override getGeometry(shape: QuestionCardShape) {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override component(shape: QuestionCardShape) {
		return <QuestionCard shape={shape} />
	}

	/** Plain SVG version of the card, so exports and `read_canvas` screenshots show it. */
	override toSvg(shape: QuestionCardShape) {
		return <QuestionCardSvg shape={shape} />
	}

	override getIndicatorPath(shape: QuestionCardShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 12)
		return path
	}
}

/** Record an answer on a waiting card. Answers are final: later clicks are ignored. */
export function answerQuestionCard(
	editor: Editor,
	shape: QuestionCardShape,
	answer: Pick<QuestionCardProps, 'answerKind'> & Partial<QuestionCardProps>,
): void {
	const current = editor.getShape<QuestionCardShape>(shape.id)
	if (!current || current.props.answerKind !== 'none') return
	editor.updateShape<QuestionCardShape>({
		id: shape.id,
		type: QUESTION_CARD_TYPE,
		props: { answerOption: -1, answerText: '', ...answer },
	})
}

function QuestionCard({ shape }: { shape: QuestionCardShape }) {
	const editor = useEditor()
	const ref = useRef<HTMLDivElement>(null)
	const { question, options, recommendation, answerKind, answerOption, answerText } = shape.props
	const answered = answerKind !== 'none'

	// Grow or shrink the shape to the rendered content, outside the undo history.
	useLayoutEffect(() => {
		const height = ref.current?.offsetHeight
		if (!height || Math.abs(height - shape.props.h) < 1) return
		editor.run(
			() =>
				editor.updateShape<QuestionCardShape>({
					id: shape.id,
					type: QUESTION_CARD_TYPE,
					props: { h: height },
				}),
			{ history: 'ignore' },
		)
	})

	const choose = (answer: Parameters<typeof answerQuestionCard>[2]) => () =>
		answerQuestionCard(editor, shape, answer)
	// Keep tldraw from starting a selection or drag when a button is pressed.
	const handled = (event: React.PointerEvent) => editor.markEventAsHandled(event)

	return (
		<HTMLContainer className="question-card-container">
			<div
				ref={ref}
				className="question-card"
				data-answered={answered}
				data-testid="question-card"
				style={{ width: shape.props.w }}
			>
				<div className="question-card__header">
					<span>Claude asks</span>
					<span className="question-card__state">{answered ? 'Answered' : 'Waiting for you'}</span>
				</div>
				<div className="question-card__question">{question}</div>
				<div className="question-card__options">
					{options.map((option, index) => (
						<button
							// biome-ignore lint/suspicious/noArrayIndexKey: options are positional and fixed per card
							key={index}
							type="button"
							className="question-card__option"
							data-testid={`question-option-${index}`}
							data-recommended={index === recommendation}
							data-chosen={answerKind === 'option' && answerOption === index}
							disabled={answered}
							onPointerDown={handled}
							onClick={choose({ answerKind: 'option', answerOption: index })}
						>
							<span>{option}</span>
							{index === recommendation && (
								<span className="question-card__recommended">★ Recommended</span>
							)}
						</button>
					))}
					<button
						type="button"
						className="question-card__option question-card__option--secondary"
						data-testid="question-keep-grilling"
						data-chosen={answerKind === 'keep_grilling'}
						disabled={answered}
						onPointerDown={handled}
						onClick={choose({ answerKind: 'keep_grilling' })}
					>
						{KEEP_GRILLING_LABEL}
					</button>
				</div>
				<div className="question-card__hint">
					{answerKind === 'note'
						? `Answered with a sticky note: “${answerText}”`
						: answered
							? 'Answer sent to Claude.'
							: 'Or stick a note next to this card to answer freely.'}
				</div>
			</div>
		</HTMLContainer>
	)
}

const SVG_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

/** Split text into lines of at most `max` characters, at word boundaries. */
function wrap(text: string, max: number): string[] {
	const lines: string[] = []
	let line = ''
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (line && line.length + 1 + word.length > max) {
			lines.push(line)
			line = word
		} else {
			line = line ? `${line} ${word}` : word
		}
	}
	if (line) lines.push(line)
	return lines
}

function QuestionCardSvg({ shape }: { shape: QuestionCardShape }) {
	const { w, h, question, options, recommendation, answerKind, answerOption, answerText } =
		shape.props
	const answered = answerKind !== 'none'
	const questionLines = wrap(question, 34)
	const buttons = [...options, KEEP_GRILLING_LABEL]
	const buttonsTop = 44 + questionLines.length * 24 + 12
	const hint =
		answerKind === 'note'
			? `Answered with a sticky note: "${answerText}"`
			: answered
				? 'Answer sent to Claude.'
				: 'Or stick a note next to this card to answer freely.'
	const hintLines = wrap(hint, 52)
	const height = Math.max(h, buttonsTop + buttons.length * 46 + hintLines.length * 16 + 16)
	return (
		<g fontFamily={SVG_FONT}>
			<rect width={w} height={height} rx={12} fill="#ffffff" stroke="#c9ccd6" strokeWidth={1.5} />
			<text x={16} y={26} fontSize={12} fill="#5b6070">
				{`Claude asks · ${answered ? 'Answered' : 'Waiting for you'}`}
			</text>
			{questionLines.map((line, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
				<text key={i} x={16} y={56 + i * 24} fontSize={18} fontWeight={600} fill="#1d2130">
					{line}
				</text>
			))}
			{buttons.map((label, i) => {
				const y = buttonsTop + i * 46
				const isKeepGrilling = i === options.length
				const chosen = isKeepGrilling
					? answerKind === 'keep_grilling'
					: answerKind === 'option' && answerOption === i
				const recommended = !isKeepGrilling && i === recommendation
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: buttons are positional
					<g key={i}>
						<rect
							x={16}
							y={y}
							width={w - 32}
							height={38}
							rx={8}
							fill={chosen ? '#dbe7ff' : '#f6f7fa'}
							stroke={chosen || recommended ? '#2f6fed' : '#c9ccd6'}
							strokeWidth={recommended || chosen ? 2 : 1}
							strokeDasharray={isKeepGrilling ? '5 4' : undefined}
						/>
						<text x={28} y={y + 24} fontSize={15} fill="#1d2130">
							{label}
						</text>
						{recommended && (
							<text x={w - 28} y={y + 24} fontSize={12} fill="#2f6fed" textAnchor="end">
								★ Recommended
							</text>
						)}
					</g>
				)
			})}
			{hintLines.map((line, i) => (
				<text
					// biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
					key={i}
					x={16}
					y={buttonsTop + buttons.length * 46 + 12 + i * 16}
					fontSize={12}
					fill="#5b6070"
				>
					{line}
				</text>
			))}
		</g>
	)
}
