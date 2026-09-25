/**
 * Registers this checkout's MCP server with Claude Code for the user (any
 * working directory) and merges the working-indicator `Stop` hook into the
 * user's settings, then checks it runs. Run it through `pnpm setup:mcp`
 * (scripts/install.sh), which checks the prerequisites and installs the
 * dependencies first. Idempotent; `--uninstall` undoes it. ADR 0032.
 *
 *   pnpm setup:mcp [--no-smoke]
 *   pnpm setup:mcp --uninstall
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	addStopHook,
	desiredServer,
	isOwnServer,
	parseSettings,
	removeStopHook,
	type Settings,
	serverAction,
} from './setup-mcp/config'

const SERVER_NAME = 'tldraw-canvas'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const configDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude')
const userSettingsFile = path.join(configDir, 'settings.json')
// Claude Code keeps user-scope MCP servers in ~/.claude.json (inside
// CLAUDE_CONFIG_DIR when that is set). Only read here; writes go through `claude mcp`.
const claudeJsonFile = process.env.CLAUDE_CONFIG_DIR
	? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
	: path.join(homedir(), '.claude.json')

const args = new Set(process.argv.slice(2))
const log = (message: string) => console.log(`[setup:mcp] ${message}`)

try {
	if (args.has('--uninstall')) uninstall()
	else install()
} catch (error) {
	console.error(`[setup:mcp] ${(error as Error).message}`)
	process.exit(1)
}

function install() {
	// Read everything first, so a broken file stops the script before it changes anything.
	const existing = registeredServer()
	const settings = readUserSettings()
	const desired = desiredServer(repoRoot)

	const action = serverAction(existing, desired)
	if (action === 'none') {
		log(`MCP server "${SERVER_NAME}" already registered for this checkout`)
	} else {
		if (action === 'replace') {
			log(`replacing the user-scope "${SERVER_NAME}" entry: ${JSON.stringify(existing)}`)
			claude(['mcp', 'remove', '--scope', 'user', SERVER_NAME])
		}
		claude(['mcp', 'add-json', '--scope', 'user', SERVER_NAME, JSON.stringify(desired)])
		log(`registered MCP server "${SERVER_NAME}" (user scope) -> ${desired.args[0]}`)
	}

	const hook = addStopHook(settings, stopHookCommand())
	if (hook.changed) {
		writeUserSettings(hook.settings)
		log(`added the working-indicator Stop hook to ${userSettingsFile}`)
	} else {
		log(`Stop hook already in ${userSettingsFile}`)
	}

	verifyConnected()
	if (!args.has('--no-smoke')) smoke()
	printNextSteps()
}

function uninstall() {
	const existing = registeredServer()
	const settings = readUserSettings()

	if (isOwnServer(existing, repoRoot)) {
		claude(['mcp', 'remove', '--scope', 'user', SERVER_NAME])
		log(`removed MCP server "${SERVER_NAME}" (user scope)`)
	} else if (existing === undefined) {
		log(`no user-scope MCP server "${SERVER_NAME}" registered`)
	} else {
		log(
			`left the user-scope "${SERVER_NAME}" entry alone: it does not run this checkout (${JSON.stringify(existing)})`,
		)
	}

	const hook = removeStopHook(settings, stopHookCommand())
	if (hook.changed) {
		writeUserSettings(hook.settings)
		log(`removed the working-indicator Stop hook from ${userSettingsFile}`)
	} else {
		log(`no working-indicator Stop hook in ${userSettingsFile}`)
	}
	log('the project-scope .mcp.json and .claude/settings.json in this repo are unchanged')
}

function registeredServer(): unknown {
	const config = parseSettings(readIfExists(claudeJsonFile), claudeJsonFile)
	const servers = config.mcpServers as Record<string, unknown> | undefined
	return servers?.[SERVER_NAME]
}

function readUserSettings(): Settings {
	return parseSettings(readIfExists(userSettingsFile), userSettingsFile)
}

function writeUserSettings(settings: Settings) {
	mkdirSync(configDir, { recursive: true })
	writeFileSync(userSettingsFile, `${JSON.stringify(settings, null, 2)}\n`)
}

/** The hook command comes from the repo's own `.claude/settings.json`, so the two never drift. */
function stopHookCommand(): string {
	const file = path.join(repoRoot, '.claude', 'settings.json')
	const settings = parseSettings(readIfExists(file), file) as {
		hooks?: { Stop?: { hooks?: { command?: string }[] }[] }
	}
	const command = settings.hooks?.Stop?.flatMap((group) => group.hooks ?? []).find((hook) =>
		hook.command?.includes('/agent/stop'),
	)?.command
	if (!command) throw new Error(`${file} has no Stop hook posting to /agent/stop`)
	return command
}

/** Like `/mcp`: outside the repo, so the user-scope entry is what gets health-checked. */
function verifyConnected() {
	const result = spawnSync('claude', ['mcp', 'get', SERVER_NAME], {
		cwd: tmpdir(),
		encoding: 'utf8',
	})
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
	if (result.status !== 0 || !/connected/i.test(output) || /failed/i.test(output)) {
		throw new Error(
			`Claude Code cannot connect to "${SERVER_NAME}":\n${output}\n` +
				`Run \`${desiredServer(repoRoot).command} ${desiredServer(repoRoot).args[0]}\` to see the server's own error.`,
		)
	}
	log(`Claude Code connects to "${SERVER_NAME}" (claude mcp get)`)
}

/** End to end through the canvas; needs tldraw offline running, so a failure only warns. */
function smoke() {
	log('smoke check: pnpm smoke (waits up to 30 s for the canvas in tldraw offline)')
	const result = spawnSync('pnpm', ['smoke', 'Hello from pnpm setup:mcp'], {
		cwd: repoRoot,
		stdio: 'inherit',
	})
	if (result.status === 0) {
		log('smoke check passed: a labelled rectangle is on the canvas')
	} else {
		log(
			'smoke check failed. The setup itself is done; the canvas did not answer. ' +
				'Start tldraw offline (or `pnpm dev` with CANVAS_BACKEND=vite) and rerun `pnpm smoke`.',
		)
	}
}

function printNextSteps() {
	console.log(`
Next steps:
  1. Start tldraw offline. The server installs the canvas into the document
     "tldraw-code session" and opens it (fallback: \`pnpm dev\` and open
     http://127.0.0.1:5173 with CANVAS_BACKEND=vite).
  2. Start Claude Code in any directory and check \`/mcp\` lists ${SERVER_NAME}.
     To be woken by &agent sticky notes, start it as
       claude --dangerously-load-development-channels server:${SERVER_NAME}
  3. Ask Claude to call canvas_smoke_test, or run \`pnpm smoke\` here.
After changing apps/canvas/src, rerun \`pnpm build:board-script\`. Undo with \`pnpm setup:mcp --uninstall\`.`)
}

function claude(commandArgs: string[]) {
	const result = spawnSync('claude', commandArgs, { encoding: 'utf8' })
	if (result.status !== 0) {
		throw new Error(`claude ${commandArgs.join(' ')} failed:\n${result.stderr || result.stdout}`)
	}
}

function readIfExists(file: string): string | undefined {
	return existsSync(file) ? readFileSync(file, 'utf8') : undefined
}
