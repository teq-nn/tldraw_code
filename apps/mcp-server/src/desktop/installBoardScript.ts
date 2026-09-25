import { writeFile as writeFileToDisk } from 'node:fs/promises'
import path from 'node:path'
import type { AgentApi, ScriptStatus, TldrawOfflineDoc } from './agentApiClient'

export interface BoardScriptBundle {
	/** `config.js`: registers the shapes, the TopPanel (bridge pill) and `getShapeVisibility`. */
	configJs: string
	/** `main.js`: connects the mounted editor to the MCP server's bridge. */
	mainJs: string
}

export interface InstallBoardScriptOptions {
	/** The session document's name (with or without `.tldraw`); found or created. */
	docName: string
	/** Passed to `docs/create` when the document does not exist yet. */
	directory?: string
	/** How often to poll `script-status` while waiting for it to apply. */
	pollIntervalMs?: number
	/** How long to wait for `script-status: applied` before giving up. */
	timeoutMs?: number
	/** Injectable for tests; defaults to the real filesystem. */
	writeFile?: (path: string, content: string) => Promise<void>
	/** Injectable for tests; defaults to a real timer. */
	sleep?: (ms: number) => Promise<void>
	log?: (message: string) => void
}

export interface InstallBoardScriptResult {
	docId: string
	docName: string
	/** Absolute path of the session document, or null if it was never saved. */
	filePath: string | null
}

const DEFAULT_POLL_INTERVAL_MS = 300
const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Find or create the session document via the Agent API and install the
 * built canvas bundle as its board script (ticket #16): write `config.js`
 * and `main.js` to the live script workspace, wait for the watcher to apply
 * them, then save. The board script connects to the MCP server's bridge on
 * its own once applied, exactly like the Vite canvas; this function's job
 * ends at "applied".
 */
export async function installBoardScript(
	client: AgentApi,
	bundle: BoardScriptBundle,
	options: InstallBoardScriptOptions,
): Promise<InstallBoardScriptResult> {
	const writeFile = options.writeFile ?? ((p, content) => writeFileToDisk(p, content, 'utf8'))
	const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
	const log = options.log ?? (() => {})

	const doc = await findOrCreateDoc(client, options.docName, options.directory)
	log(`using session document "${doc.name}" (${doc.id})`)

	const workspace = await client.scriptWorkspace(doc.id)
	const configJsPath = path.join(path.dirname(workspace.mainJsPath), 'config.js')
	// This document is this tool's own session document (found or created above), not a
	// canvas the user hand-edits scripts on, so always installing the latest built bundle
	// is correct here — unlike the general agent guidance to extend, not clobber.
	await writeFile(workspace.mainJsPath, bundle.mainJs)
	await writeFile(configJsPath, bundle.configJs)
	log(`wrote board script to ${workspace.scriptDir}`)

	await waitForApplied(client, doc.id, {
		pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
		timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
		sleep,
	})
	log('board script applied')

	// Installing the script marks the document unsaved; saving is our job (only for a local doc).
	await client.exec(doc.id, 'await helpers.saveDoc()')

	return { docId: doc.id, docName: doc.name, filePath: doc.filePath }
}

/**
 * Exact (case-insensitive) name match among local documents, or a freshly
 * created one. `getDocs` always reports `name` without the `.tldraw`
 * extension regardless of how the document was named (verified against the
 * running app), so both sides are compared with it stripped.
 */
async function findOrCreateDoc(
	client: AgentApi,
	name: string,
	directory: string | undefined,
): Promise<TldrawOfflineDoc> {
	const docs = await client.search<TldrawOfflineDoc[]>(
		`return await api.getDocs({ name: ${JSON.stringify(name)} })`,
	)
	const wanted = stripExtension(name).toLowerCase()
	const existing = docs.find(
		(doc) => doc.ownership === 'local' && stripExtension(doc.name).toLowerCase() === wanted,
	)
	if (existing) return existing
	return client.createDoc({ name, ...(directory ? { directory } : {}) })
}

function stripExtension(name: string): string {
	return name.endsWith('.tldraw') ? name.slice(0, -'.tldraw'.length) : name
}

interface WaitForAppliedOptions {
	pollIntervalMs: number
	timeoutMs: number
	sleep: (ms: number) => Promise<void>
}

async function waitForApplied(
	client: AgentApi,
	docId: string,
	{ pollIntervalMs, timeoutMs, sleep }: WaitForAppliedOptions,
): Promise<ScriptStatus> {
	const deadline = Date.now() + timeoutMs
	for (;;) {
		const status = await client.scriptStatus(docId)
		if (status.state === 'applied') return status
		if (status.state === 'error') {
			throw new Error(
				`board script failed to apply: ${status.lastApplyError ?? 'unknown error'}` +
					(status.errorLogPath ? ` (see ${status.errorLogPath})` : ''),
			)
		}
		if (Date.now() >= deadline) {
			throw new Error(`board script did not apply within ${timeoutMs} ms (still "${status.state}")`)
		}
		await sleep(pollIntervalMs)
	}
}
