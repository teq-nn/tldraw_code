import { readFile as readFileFromDisk } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface TldrawOfflineConfig {
	port: number
	token: string
}

export interface ReadServerConfigOptions {
	/** Defaults to {@link defaultServerConfigPath}. */
	path?: string
	/** Injectable for tests; defaults to reading the real file. */
	readFile?: (path: string) => Promise<string>
}

/** `~/.config/tldraw/server.json`, overridable with `TLDRAW_OFFLINE_SERVER_JSON` (tests, CI). */
export function defaultServerConfigPath(): string {
	return (
		process.env.TLDRAW_OFFLINE_SERVER_JSON ??
		path.join(os.homedir(), '.config', 'tldraw', 'server.json')
	)
}

/**
 * Read tldraw offline's per-launch `port` and `token` from its
 * `server.json`. Never cached by a caller across requests: the token is
 * re-read from disk on every call, per {@link ReadServerConfigOptions}'s
 * default, so a relaunched app's new token is always used and nothing here
 * holds a stale one in memory longer than one request (ticket #16). Throws a
 * plain, tokenless error if the app is not running or the file is malformed.
 */
export async function readServerConfig(
	options: ReadServerConfigOptions = {},
): Promise<TldrawOfflineConfig> {
	const configPath = options.path ?? defaultServerConfigPath()
	const readFile = options.readFile ?? ((p: string) => readFileFromDisk(p, 'utf8'))

	let raw: string
	try {
		raw = await readFile(configPath)
	} catch (error) {
		throw new Error(
			`tldraw offline is not running (could not read ${configPath}: ` +
				`${error instanceof Error ? error.message : String(error)})`,
		)
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		throw new Error(`tldraw offline's server.json at ${configPath} is not valid JSON`)
	}

	const port = (parsed as { port?: unknown }).port
	const token = (parsed as { token?: unknown }).token
	if (typeof port !== 'number' || typeof token !== 'string' || token.length === 0) {
		throw new Error(`tldraw offline's server.json at ${configPath} is missing "port" or "token"`)
	}
	return { port, token }
}
