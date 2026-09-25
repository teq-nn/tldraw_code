import { AgentApiClient } from './agentApiClient'
import { readBoardScriptBundle } from './boardScriptBundle'
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
 * `CANVAS_BACKEND=desktop` (ticket #16): install the canvas as tldraw
 * offline's board script for this session instead of the Vite app. Finds or
 * creates the session document via the Agent API and installs the bundle
 * built by `build:board-script`, waiting for it to apply. From there the
 * board script connects to the MCP server's bridge on its own, exactly like
 * the Vite canvas — this function's job ends at "applied".
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
export { installBoardScript } from './installBoardScript'
