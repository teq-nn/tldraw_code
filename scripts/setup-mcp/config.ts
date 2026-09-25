/**
 * The two pieces of Claude Code user config that `pnpm setup:mcp` owns (ADR
 * 0033): the user-scope `tldraw-canvas` MCP server entry and the `Stop` hook
 * that ends the working indicator (ADR 0025). Pure functions over parsed
 * JSON, so the merge rules are tested without touching the user's files.
 */
import path from 'node:path'

export type Settings = Record<string, unknown>

interface HookCommand {
	type?: unknown
	command?: unknown
	[key: string]: unknown
}

interface HookGroup {
	hooks?: HookCommand[]
	[key: string]: unknown
}

export interface McpServer {
	type: 'stdio'
	command: string
	args: string[]
	env: Record<string, string>
}

export interface Change {
	settings: Settings
	changed: boolean
}

/** Adds `command` as a `Stop` hook unless some `Stop` group already runs it. */
export function addStopHook(settings: Settings, command: string): Change {
	if (stopGroups(settings).some((group) => runs(group, command))) {
		return { settings, changed: false }
	}
	const hooks = isObject(settings.hooks) ? settings.hooks : {}
	return {
		settings: {
			...settings,
			hooks: {
				...hooks,
				Stop: [...stopGroups(settings), { hooks: [{ type: 'command', command }] }],
			},
		},
		changed: true,
	}
}

/**
 * Removes every `Stop` hook that runs `command`, and whatever it leaves empty
 * (the group, `Stop`, `hooks`), so a remove after an add restores the input.
 */
export function removeStopHook(settings: Settings, command: string): Change {
	const groups = stopGroups(settings)
	if (!groups.some((group) => runs(group, command))) return { settings, changed: false }

	const kept = groups
		.map((group) =>
			runs(group, command)
				? { ...group, hooks: (group.hooks ?? []).filter((hook) => hook.command !== command) }
				: group,
		)
		.filter((group) => (group.hooks ?? []).length > 0)
	const { Stop: _removed, ...otherEvents } = settings.hooks as Record<string, unknown>
	const hooks = kept.length > 0 ? { ...otherEvents, Stop: kept } : otherEvents
	const { hooks: _old, ...rest } = settings
	return {
		settings: Object.keys(hooks).length > 0 ? { ...rest, hooks } : rest,
		changed: true,
	}
}

/**
 * Parses a settings file's text; `undefined` (no file) and blank text are
 * empty settings. Anything but a JSON object throws, naming the file, so a
 * broken file is never overwritten.
 */
export function parseSettings(text: string | undefined, file: string): Settings {
	if (text === undefined || text.trim() === '') return {}
	let parsed: unknown
	try {
		parsed = JSON.parse(text)
	} catch (error) {
		throw new Error(`${file} is not valid JSON (${(error as Error).message}); fix it and rerun`)
	}
	if (!isObject(parsed)) throw new Error(`${file} does not hold a JSON object; fix it and rerun`)
	return parsed
}

/**
 * The server entry for this checkout: absolute paths, so Claude Code finds the
 * server from any working directory (the repo's `.mcp.json` is relative).
 */
export function desiredServer(repoRoot: string): McpServer {
	return {
		type: 'stdio',
		command: path.join(repoRoot, 'node_modules', '.bin', 'tsx'),
		args: [path.join(repoRoot, 'apps', 'mcp-server', 'src', 'main.ts')],
		env: {},
	}
}

export function serverAction(existing: unknown, desired: McpServer): 'add' | 'replace' | 'none' {
	if (existing === undefined) return 'add'
	return sameServer(existing, desired) ? 'none' : 'replace'
}

/** Compares what runs, not how Claude Code happened to write it (key order, a default type or env). */
function sameServer(existing: unknown, desired: McpServer): boolean {
	if (!isObject(existing)) return false
	const normalize = (server: Record<string, unknown>) =>
		JSON.stringify([
			server.type ?? 'stdio',
			server.command,
			server.args ?? [],
			Object.entries(isObject(server.env) ? server.env : {}).sort(),
		])
	return normalize(existing) === normalize({ ...desired })
}

/** Whether `existing` is the entry this checkout installs, so uninstall may remove it. */
export function isOwnServer(existing: unknown, repoRoot: string): boolean {
	return existing !== undefined && serverAction(existing, desiredServer(repoRoot)) === 'none'
}

function stopGroups(settings: Settings): HookGroup[] {
	const hooks = settings.hooks
	if (!isObject(hooks) || !Array.isArray(hooks.Stop)) return []
	return hooks.Stop as HookGroup[]
}

function runs(group: HookGroup, command: string): boolean {
	return (group.hooks ?? []).some((hook) => hook.command === command)
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
