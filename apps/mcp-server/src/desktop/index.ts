import { AgentApiClient } from './agentApiClient'
import { readBoardScriptBundle } from './boardScriptBundle'
import { DesktopReadiness } from './desktopReadiness'
import { type InstallBoardScriptResult, installBoardScript } from './installBoardScript'

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

/**
 * Install the canvas as tldraw offline's board script for a session
 * (ticket #16): finds or creates the session document via the Agent API and
 * always (re)installs the bundle built by `build:board-script`, waiting for
 * it to apply. From there the board script connects to the MCP server's
 * bridge on its own, exactly like the Vite canvas — this function's job ends
 * at "applied". Kept as a standalone, unconditional-install primitive (e.g.
 * for a future manual "reinstall" command); the live server instead shares
 * one {@link DesktopReadiness} between startup and every later command
 * (ticket #17), which only reinstalls when the bundle actually changed.
 */
export async function startDesktopBackend(
	options: DesktopBackendOptions = {},
): Promise<InstallBoardScriptResult> {
	const bundle = await readBoardScriptBundle()
	const client = new AgentApiClient()
	return installBoardScript(client, bundle, {
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
