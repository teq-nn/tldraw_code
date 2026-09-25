import { readFile as readFileFromDisk, writeFile as writeFileToDisk } from 'node:fs/promises'
import { BridgeErrorCode } from '@tldraw-code/protocol'
import { CanvasBridgeError } from '../bridge'
import type { AgentApi, ScriptWorkspace } from './agentApiClient'
import { readBoardScriptBundle } from './boardScriptBundle'
import {
	type BoardScriptBundle,
	configJsPathOf,
	DEFAULT_POLL_INTERVAL_MS,
	DEFAULT_TIMEOUT_MS,
	findOrCreateDoc,
	writeAndApply,
} from './installBoardScript'

export interface DesktopReadinessOptions {
	client: AgentApi
	/** The session document's name (with or without `.tldraw`). */
	docName: string
	/** Passed to `docs/create` when the document does not exist yet. */
	directory?: string
	/** Defaults to {@link readBoardScriptBundle}. */
	readBundle?: () => Promise<BoardScriptBundle>
	/** Injectable for tests; defaults to the real filesystem. */
	readFile?: (path: string) => Promise<string>
	/** Injectable for tests; defaults to the real filesystem. */
	writeFile?: (path: string, content: string) => Promise<void>
	/** How often to poll `script-status` while an install applies. */
	pollIntervalMs?: number
	/** How long to wait for `script-status: applied` before giving up. */
	applyTimeoutMs?: number
	/** Injectable for tests; defaults to a real timer (used only for the apply-wait above). */
	sleep?: (ms: number) => Promise<void>
	/** How long to wait for the canvas to (re)connect to the bridge before giving up. */
	connectTimeoutMs?: number
	/** How often to check the connection while waiting. */
	connectPollIntervalMs?: number
	log?: (message: string) => void
}

const DEFAULT_CONNECT_TIMEOUT_MS = 5_000
const DEFAULT_CONNECT_POLL_INTERVAL_MS = 100

interface DesktopSession {
	docId: string
	docName: string
	filePath: string | null
	workspace: ScriptWorkspace
}

/** What {@link DesktopReadiness.ensureInstalled} resolved to, for the caller's own logging. */
export interface DesktopInstallResult {
	docId: string
	docName: string
	filePath: string | null
}

/**
 * Keeps a tldraw offline document's board script matching the built canvas
 * bundle, and its bridge connection alive, across a whole MCP server
 * session — the per-tool-call half of ticket #17 (the other half,
 * `installBoardScript`, is the one-time install at server startup).
 *
 * `ensureReady` is meant to run before every command the desktop backend
 * sends to the canvas ({@link DesktopCanvasBridge}): on the fast path
 * (nothing changed, already connected) it costs nothing but two local file
 * reads. It only talks to the Agent API when the cached document/workspace
 * is unknown, or the installed script no longer matches the built bundle —
 * which is exactly when a rebuild, an app restart, or a first call needs it.
 */
export class DesktopReadiness {
	private readonly client: AgentApi
	private readonly docName: string
	private readonly directory: string | undefined
	private readonly readBundle: () => Promise<BoardScriptBundle>
	private readonly readFile: (path: string) => Promise<string>
	private readonly writeFile: (path: string, content: string) => Promise<void>
	private readonly sleep: (ms: number) => Promise<void>
	private readonly pollIntervalMs: number
	private readonly applyTimeoutMs: number
	private readonly connectTimeoutMs: number
	private readonly connectPollIntervalMs: number
	private readonly log: (message: string) => void
	private session: DesktopSession | undefined

	constructor(options: DesktopReadinessOptions) {
		this.client = options.client
		this.docName = options.docName
		this.directory = options.directory
		this.readBundle = options.readBundle ?? (() => readBoardScriptBundle())
		this.readFile = options.readFile ?? ((p) => readFileFromDisk(p, 'utf8'))
		this.writeFile = options.writeFile ?? ((p, content) => writeFileToDisk(p, content, 'utf8'))
		this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
		this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
		this.applyTimeoutMs = options.applyTimeoutMs ?? DEFAULT_TIMEOUT_MS
		this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
		this.connectPollIntervalMs = options.connectPollIntervalMs ?? DEFAULT_CONNECT_POLL_INTERVAL_MS
		this.log = options.log ?? (() => {})
	}

	/**
	 * Makes sure the installed board script matches the built bundle
	 * (reinstalling if not) and the canvas is connected to the bridge,
	 * waiting for a reconnect that a fresh install or an app restart causes.
	 * Throws a {@link CanvasBridgeError} with an actionable message when
	 * tldraw offline is not reachable, the session document is not open, or
	 * the canvas never connects.
	 */
	async ensureReady(isConnected: () => boolean): Promise<void> {
		await this.ensureInstalled()
		if (isConnected()) return
		if (await this.waitForConnected(isConnected)) return
		throw new CanvasBridgeError({
			code: BridgeErrorCode.NotConnected,
			message:
				`tldraw offline has "${this.docName}" open, but its canvas board script has not connected ` +
				`to the bridge yet (waited ${this.connectTimeoutMs} ms). If you just changed the canvas ` +
				'source and rebuilt it, wait for the reload and try again.',
		})
	}

	/**
	 * Installs the built bundle if it is not already on disk for the session
	 * document, without waiting for a connection. Used both by `ensureReady`
	 * and as the eager install at server startup, so a stale bundle is
	 * reinstalled exactly the same way whether it is noticed at startup or on
	 * the first tool call.
	 */
	async ensureInstalled(): Promise<DesktopInstallResult> {
		const bundle = await this.readBundle()
		if (!(this.session && (await this.filesMatch(bundle, this.session.workspace)))) {
			const doc = await this.resolveDoc()
			const workspace = await this.client.scriptWorkspace(doc.id)
			this.session = { docId: doc.id, docName: doc.name, filePath: doc.filePath, workspace }

			if (!(await this.filesMatch(bundle, workspace))) {
				await writeAndApply(this.client, doc, workspace, bundle, {
					writeFile: this.writeFile,
					sleep: this.sleep,
					log: this.log,
					pollIntervalMs: this.pollIntervalMs,
					timeoutMs: this.applyTimeoutMs,
				})
			}
		}
		const { docId, docName, filePath } = this.session
		return { docId, docName, filePath }
	}

	/** Best-effort `helpers.saveDoc()` for the resolved session document; a no-op before one exists. */
	async save(): Promise<void> {
		if (!this.session) return
		try {
			await this.client.exec(this.session.docId, 'await helpers.saveDoc()')
		} catch (error) {
			this.log(
				`could not save "${this.session.docName}" after a canvas write: ` +
					(error instanceof Error ? error.message : String(error)),
			)
		}
	}

	private async resolveDoc() {
		try {
			return await findOrCreateDoc(this.client, this.docName, this.directory)
		} catch (error) {
			throw new CanvasBridgeError({
				code: BridgeErrorCode.NotConnected,
				message:
					`tldraw offline is not running, or "${this.docName}" is not open in it ` +
					`(${error instanceof Error ? error.message : String(error)}). Start tldraw offline ` +
					`and open "${this.docName}", then try again.`,
			})
		}
	}

	private async filesMatch(
		bundle: BoardScriptBundle,
		workspace: ScriptWorkspace,
	): Promise<boolean> {
		try {
			const [mainJs, configJs] = await Promise.all([
				this.readFile(workspace.mainJsPath),
				this.readFile(configJsPathOf(workspace)),
			])
			return mainJs === bundle.mainJs && configJs === bundle.configJs
		} catch {
			// Not installed yet (or the path no longer exists): treat as changed.
			return false
		}
	}

	private async waitForConnected(isConnected: () => boolean): Promise<boolean> {
		const deadline = Date.now() + this.connectTimeoutMs
		while (Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, this.connectPollIntervalMs))
			if (isConnected()) return true
		}
		return isConnected()
	}
}
