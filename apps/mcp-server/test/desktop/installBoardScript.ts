import type {
	AgentApi,
	CreateDocOptions,
	ScriptStatus,
	ScriptWorkspace,
	TldrawOfflineDoc,
} from '../../src/desktop/agentApiClient'

/** Stand-in for the Agent API: an in-memory doc store plus a scripted status sequence. */
export class FakeAgentApi implements AgentApi {
	docs: TldrawOfflineDoc[] = []
	created: CreateDocOptions[] = []
	writes: { docId: string; code: string }[] = []
	scriptWorkspaceCalls: string[] = []
	statuses: ScriptStatus[] = [{ state: 'applied' }]
	private statusIndex = 0

	async search<T>(code: string): Promise<T> {
		const match = /name:\s*"([^"]*)"/.exec(code)
		const name = match?.[1] ?? ''
		return this.docs.filter((doc) => doc.name.toLowerCase().includes(name.toLowerCase())) as T
	}

	async createDoc(options: CreateDocOptions): Promise<TldrawOfflineDoc> {
		this.created.push(options)
		// The real API always reports `name` without the `.tldraw` extension,
		// regardless of how the document was named (verified against the app).
		const name = options.name.endsWith('.tldraw')
			? options.name.slice(0, -'.tldraw'.length)
			: options.name
		const doc: TldrawOfflineDoc = {
			id: `doc:${options.name}`,
			name,
			ownership: 'local',
			filePath: `/fake/${options.name}.tldraw`,
			documentId: `did:${options.name}`,
			unsavedChanges: false,
		}
		this.docs.push(doc)
		return doc
	}

	async exec<T>(docId: string, code: string): Promise<T> {
		this.writes.push({ docId, code })
		return undefined as T
	}

	async scriptWorkspace(docId: string): Promise<ScriptWorkspace> {
		this.scriptWorkspaceCalls.push(docId)
		return {
			scriptDir: `/fake/${docId}/script`,
			mainJsPath: `/fake/${docId}/script/main.js`,
			isDefaultScript: true,
		}
	}

	async scriptStatus(_docId: string): Promise<ScriptStatus> {
		const status = this.statuses[Math.min(this.statusIndex, this.statuses.length - 1)]
		this.statusIndex++
		return status as ScriptStatus
	}
}
