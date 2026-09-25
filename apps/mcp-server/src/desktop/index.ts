import { AgentApiClient } from './agentApiClient'
import { DesktopReadiness } from './desktopReadiness'

export const DEFAULT_DESKTOP_DOC_NAME = 'tldraw-code session'

export interface DesktopBackendOptions {
	/** The session document's name; defaults to `CANVAS_DESKTOP_DOC_NAME` or {@link DEFAULT_DESKTOP_DOC_NAME}. */
	docName?: string
	/** Passed to `docs/create` when the document does not exist; defaults to `CANVAS_DESKTOP_DOC_DIR`. */
	directory?: string
	log?: (message: string) => void
}

/**
 * Build the {@link DesktopReadiness} that both `main.ts`'s eager startup
 * install and `DesktopCanvasBridge` (before every command) share (ticket
 * #17): same session document, same document-name/directory resolution
 * (env vars, then defaults).
 */
export function createDesktopReadiness(options: DesktopBackendOptions = {}): DesktopReadiness {
	return new DesktopReadiness({
		client: new AgentApiClient(),
		docName: options.docName ?? process.env.CANVAS_DESKTOP_DOC_NAME ?? DEFAULT_DESKTOP_DOC_NAME,
		directory: options.directory ?? process.env.CANVAS_DESKTOP_DOC_DIR,
		log: options.log,
	})
}

export { AgentApiClient } from './agentApiClient'
export { readBoardScriptBundle } from './boardScriptBundle'
export { DesktopCanvasBridge, type DesktopCanvasBridgeOptions } from './desktopCanvasBridge'
export { DesktopReadiness, type DesktopReadinessOptions } from './desktopReadiness'
export { installBoardScript } from './installBoardScript'
