import {
	type ReadServerConfigOptions,
	readServerConfig,
	type TldrawOfflineConfig,
} from './serverConfig'

export interface TldrawOfflineDoc {
	id: string
	name: string
	ownership: 'local' | 'remote' | 'server'
	filePath: string | null
	documentId: string | null
	unsavedChanges: boolean | null
}

export interface CreateDocOptions {
	name: string
	directory?: string
}

export interface ScriptWorkspace {
	scriptDir: string
	mainJsPath: string
	isDefaultScript: boolean
}

export interface ScriptStatus {
	state: 'pending' | 'applied' | 'error'
	lastApplyError?: string | null
	errorLogPath?: string | null
}

export interface AgentApiClientOptions {
	/** Re-run before every request; defaults to {@link readServerConfig}. */
	readConfig?: () => Promise<TldrawOfflineConfig>
	/** Passed to {@link readServerConfig} when {@link readConfig} is not given. */
	serverConfig?: ReadServerConfigOptions
	/** Injectable for tests; defaults to the global `fetch`. */
	fetchImpl?: typeof fetch
}

/**
 * The subset of the Agent API {@link installBoardScript} needs, as an
 * interface rather than the {@link AgentApiClient} class: tests fake this
 * directly instead of standing up a fake HTTP server.
 */
export interface AgentApi {
	search<T>(code: string): Promise<T>
	createDoc(options: CreateDocOptions): Promise<TldrawOfflineDoc>
	exec<T>(docId: string, code: string): Promise<T>
	scriptWorkspace(docId: string): Promise<ScriptWorkspace>
	scriptStatus(docId: string): Promise<ScriptStatus>
}

/**
 * Client for tldraw offline's local Agent API (ticket #16). Talks only to
 * `127.0.0.1` — never `localhost`, so a request cannot leave loopback via
 * DNS rebinding — and reads the bearer token fresh from `server.json` on
 * every request via {@link readServerConfig}'s own no-caching default:
 * nothing in this class holds a token in memory between calls, and it is
 * never logged (errors below quote the response body, never the request).
 */
export class AgentApiClient implements AgentApi {
	private readonly readConfig: () => Promise<TldrawOfflineConfig>
	private readonly fetchImpl: typeof fetch

	constructor(options: AgentApiClientOptions = {}) {
		this.readConfig = options.readConfig ?? (() => readServerConfig(options.serverConfig))
		this.fetchImpl = options.fetchImpl ?? fetch
	}

	/** `POST /api/search`: run JavaScript against the `api` object. */
	search<T>(code: string): Promise<T> {
		return this.request<T>('POST', '/api/search', { code })
	}

	/** `POST /api/docs/create`: create, open and save a new named document. */
	createDoc(options: CreateDocOptions): Promise<TldrawOfflineDoc> {
		return this.request<TldrawOfflineDoc>('POST', '/api/docs/create', options)
	}

	/**
	 * `POST /api/doc/:id/exec`: run JavaScript against the live `editor`.
	 * `docId` is taken as is, not percent-encoded: the app hands out ids like
	 * `tldr:file:<base64url>` and matches the `:id` path segment literally
	 * (verified against the running app), so encoding it (`%3A` for `:`)
	 * makes the app answer `404 Document not found`.
	 */
	exec<T>(docId: string, code: string): Promise<T> {
		return this.request<T>('POST', `/api/doc/${docId}/exec`, { code })
	}

	/** `POST /api/doc/:id/script-workspace`: the live script directory's paths. */
	scriptWorkspace(docId: string): Promise<ScriptWorkspace> {
		return this.request<ScriptWorkspace>('POST', `/api/doc/${docId}/script-workspace`)
	}

	/** `GET /api/doc/:id/script-status`: the script watcher's current state. */
	scriptStatus(docId: string): Promise<ScriptStatus> {
		return this.request<ScriptStatus>('GET', `/api/doc/${docId}/script-status`)
	}

	private async request<T>(method: string, urlPath: string, body?: unknown): Promise<T> {
		const { port, token } = await this.readConfig()
		const response = await this.fetchImpl(`http://127.0.0.1:${port}${urlPath}`, {
			method,
			headers: {
				authorization: `Bearer ${token}`,
				...(body !== undefined ? { 'content-type': 'application/json' } : {}),
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		})
		const text = await response.text()
		let json: unknown
		try {
			json = text.length > 0 ? JSON.parse(text) : undefined
		} catch {
			throw new Error(
				`tldraw offline ${method} ${urlPath} returned a non-JSON response (HTTP ${response.status})`,
			)
		}
		const record = json && typeof json === 'object' ? (json as Record<string, unknown>) : undefined
		if (!response.ok || record?.success === false) {
			const message = typeof record?.error === 'string' ? record.error : text.slice(0, 500)
			throw new Error(
				`tldraw offline ${method} ${urlPath} failed (HTTP ${response.status}): ${message}`,
			)
		}
		return (record && 'result' in record ? record.result : json) as T
	}
}
