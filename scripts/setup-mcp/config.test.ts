import { describe, expect, it } from 'vitest'
import {
	addStopHook,
	desiredServer,
	isOwnServer,
	parseSettings,
	removeStopHook,
	serverAction,
} from './config'

const CURL = 'curl -s -m 2 -X POST http://127.0.0.1:4477/agent/stop'

describe('addStopHook', () => {
	it('adds the hook to empty settings', () => {
		const { settings, changed } = addStopHook({}, CURL)
		expect(changed).toBe(true)
		expect(settings).toEqual({ hooks: { Stop: [{ hooks: [{ type: 'command', command: CURL }] }] } })
	})

	it('keeps other settings, other events and existing Stop hooks', () => {
		const before = {
			model: 'opus',
			hooks: {
				PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }],
				Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }],
			},
		}
		const { settings, changed } = addStopHook(before, CURL)
		expect(changed).toBe(true)
		expect(settings).toEqual({
			model: 'opus',
			hooks: {
				PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard' }] }],
				Stop: [
					{ hooks: [{ type: 'command', command: 'notify-send done' }] },
					{ hooks: [{ type: 'command', command: CURL }] },
				],
			},
		})
	})

	it('does not mutate its input', () => {
		const before = { hooks: { Stop: [] } }
		addStopHook(before, CURL)
		expect(before).toEqual({ hooks: { Stop: [] } })
	})

	it('is a no-op when the hook is already there, in any group', () => {
		const once = addStopHook({}, CURL).settings
		const twice = addStopHook(once, CURL)
		expect(twice.changed).toBe(false)
		expect(twice.settings).toEqual(once)

		const shared = {
			hooks: {
				Stop: [
					{
						hooks: [
							{ type: 'command', command: 'other' },
							{ type: 'command', command: CURL },
						],
					},
				],
			},
		}
		expect(addStopHook(shared, CURL).changed).toBe(false)
	})
})

describe('removeStopHook', () => {
	it('undoes addStopHook exactly', () => {
		const before = {
			model: 'opus',
			hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }] },
		}
		const { settings, changed } = removeStopHook(addStopHook(before, CURL).settings, CURL)
		expect(changed).toBe(true)
		expect(settings).toEqual(before)
	})

	it('drops empty groups, Stop and hooks it leaves behind', () => {
		const { settings } = removeStopHook(addStopHook({ model: 'opus' }, CURL).settings, CURL)
		expect(settings).toEqual({ model: 'opus' })
	})

	it('keeps other hooks in a shared group', () => {
		const shared = {
			hooks: {
				Stop: [
					{
						hooks: [
							{ type: 'command', command: 'other' },
							{ type: 'command', command: CURL },
						],
					},
				],
			},
		}
		expect(removeStopHook(shared, CURL).settings).toEqual({
			hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other' }] }] },
		})
	})

	it('is a no-op when the hook is not there', () => {
		const before = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'other' }] }] } }
		const { settings, changed } = removeStopHook(before, CURL)
		expect(changed).toBe(false)
		expect(settings).toEqual(before)
	})
})

describe('parseSettings', () => {
	it('reads a missing or empty file as empty settings', () => {
		expect(parseSettings(undefined, 'settings.json')).toEqual({})
		expect(parseSettings('  \n', 'settings.json')).toEqual({})
	})

	it('refuses a file that is not a JSON object, naming it', () => {
		expect(() => parseSettings('{ "hooks": ', '/x/settings.json')).toThrow(/\/x\/settings\.json/)
		expect(() => parseSettings('[]', '/x/settings.json')).toThrow(/\/x\/settings\.json/)
	})
})

describe('the MCP server entry', () => {
	const ours = desiredServer('/repo')

	it('points at the repo by absolute path', () => {
		expect(ours).toEqual({
			type: 'stdio',
			command: '/repo/node_modules/.bin/tsx',
			args: ['/repo/apps/mcp-server/src/main.ts'],
			env: {},
		})
	})

	it('is added when missing, kept when equal, replaced when it differs', () => {
		expect(serverAction(undefined, ours)).toBe('add')
		expect(serverAction(structuredClone(ours), ours)).toBe('none')
		expect(serverAction(desiredServer('/elsewhere'), ours)).toBe('replace')
		expect(serverAction({ ...ours, env: { CANVAS_BRIDGE_PORT: '4478' } }, ours)).toBe('replace')
	})

	it('ignores key order, a missing env and a missing type when comparing', () => {
		const { args, command } = ours
		expect(serverAction({ args, command }, ours)).toBe('none')
		expect(serverAction({ env: {}, args, command, type: 'stdio' }, ours)).toBe('none')
		expect(isOwnServer({ args, command }, '/repo')).toBe(true)
	})

	it('counts as ours only when it runs this repo', () => {
		expect(isOwnServer(desiredServer('/repo'), '/repo')).toBe(true)
		expect(isOwnServer(desiredServer('/elsewhere'), '/repo')).toBe(false)
		expect(isOwnServer(undefined, '/repo')).toBe(false)
	})
})
