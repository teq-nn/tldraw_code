import type {
	CanvasCommandName,
	CanvasCommandPayload,
	CanvasCommandResult,
} from '@tldraw-code/protocol'
import { CanvasBridge, type CanvasBridgeOptions } from '../bridge'
import type { DesktopReadiness } from './desktopReadiness'

/**
 * Commands that only read the canvas: skipped for the post-command save
 * (ticket #17's acceptance criterion is about a *writing* command leaving no
 * unsaved changes; saving after a pure read would just add latency).
 */
const READ_ONLY_COMMANDS: ReadonlySet<CanvasCommandName> = new Set([
	'canvas.read',
	'canvas.activity',
])

export interface DesktopCanvasBridgeOptions extends CanvasBridgeOptions {
	readiness: DesktopReadiness
}

/**
 * The bridge used for `CANVAS_BACKEND=desktop` (ticket #17). The bridge and
 * protocol themselves are unchanged (ADR 0027) — this only wraps `request`:
 * before every command it makes sure the installed board script matches the
 * built bundle and the canvas is connected (reinstalling and waiting as
 * needed, via {@link DesktopReadiness}), and after every write command it
 * saves the document, so a session survives a quit/reopen and the file never
 * sits with unsaved changes between tool calls.
 */
export class DesktopCanvasBridge extends CanvasBridge {
	private readonly readiness: DesktopReadiness

	constructor({ readiness, ...options }: DesktopCanvasBridgeOptions) {
		super(options)
		this.readiness = readiness
	}

	override async request<N extends CanvasCommandName>(
		name: N,
		payload: CanvasCommandPayload<N>,
	): Promise<CanvasCommandResult<N>> {
		await this.readiness.ensureReady(() => this.isConnected())
		const result = await super.request(name, payload)
		if (!READ_ONLY_COMMANDS.has(name)) await this.readiness.save()
		return result
	}
}
