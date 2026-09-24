import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ToolInputError } from '../errors'

const execFileAsync = promisify(execFile)

/** A GitHub repository, `owner/name`. */
export interface RepoRef {
	owner: string
	name: string
}

export function formatRepo(repo: RepoRef): string {
	return `${repo.owner}/${repo.name}`
}

/**
 * Read access to the GitHub REST API: one GET per call, parsed JSON back.
 * `undefined` means 404 (no such issue, or a feature such as sub-issues or
 * dependencies that the repository does not have). Other failures throw a
 * {@link ToolInputError} with code `tracker_error`.
 *
 * The seam for tests: they pass a fixture implementation, never the network.
 */
export interface GitHubApi {
	get<T>(path: string): Promise<T | undefined>
}

export interface GitHubApiOptions {
	/** Token for the `Authorization` header; without one only public repositories can be read. */
	token?: string
	/** API root, `https://api.github.com` by default (GitHub Enterprise: `https://<host>/api/v3`). */
	baseUrl?: string
	fetch?: typeof fetch
}

export function createGitHubApi(options: GitHubApiOptions = {}): GitHubApi {
	const baseUrl = (options.baseUrl ?? 'https://api.github.com').replace(/\/+$/, '')
	const doFetch = options.fetch ?? fetch
	const headers: Record<string, string> = {
		accept: 'application/vnd.github+json',
		'x-github-api-version': '2022-11-28',
		'user-agent': 'tldraw-code-mcp-server',
	}
	if (options.token) headers.authorization = `Bearer ${options.token}`

	return {
		async get<T>(path: string): Promise<T | undefined> {
			let response: Response
			try {
				response = await doFetch(`${baseUrl}${path}`, { headers })
			} catch (error) {
				throw new ToolInputError(
					'tracker_error',
					`could not reach the GitHub API (${(error as Error).message}).`,
				)
			}
			if (response.status === 404) return undefined
			if (!response.ok) {
				const hint =
					response.status === 401 || response.status === 403 || response.status === 429
						? options.token
							? ' Check that the token (GH_TOKEN / GITHUB_TOKEN or `gh auth token`) can read issues of this repository, or wait for the rate limit to reset.'
							: ' No GitHub token was found: set GH_TOKEN or GITHUB_TOKEN, or log in with `gh auth login` (unauthenticated reads are limited to public repositories and 60 requests per hour).'
						: ''
				throw new ToolInputError(
					'tracker_error',
					`GitHub API GET ${path} failed with HTTP ${response.status}.${hint}`,
				)
			}
			return (await response.json()) as T
		},
	}
}

/**
 * The token to read the tracker with: `GH_TOKEN`, then `GITHUB_TOKEN` (the
 * variables `gh` itself honours), then the login of the `gh` CLI if it is
 * installed. `undefined` when none is available.
 */
export async function resolveGitHubToken(
	env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
	const fromEnv = env.GH_TOKEN?.trim() || env.GITHUB_TOKEN?.trim()
	if (fromEnv) return fromEnv
	try {
		const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 5000 })
		return stdout.trim() || undefined
	} catch {
		return undefined
	}
}

/**
 * Parse `owner/name`, a GitHub URL (`https://github.com/o/r(.git)`,
 * `git@github.com:o/r.git`) or any git remote URL whose path ends in
 * `/<owner>/<name>` (e.g. a local git proxy).
 */
export function parseRepo(value: string): RepoRef | undefined {
	const trimmed = value.trim()
	const short = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(trimmed)
	const match =
		short ??
		/[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(trimmed.replace(/[?#].*$/, ''))
	if (!match?.[1] || !match[2]) return undefined
	return { owner: match[1], name: match[2].replace(/\.git$/, '') }
}

/**
 * The repository whose issues are the tracker: `CANVAS_TRACKER_REPO` if set,
 * else the `origin` remote of the git checkout the server runs in (Claude Code
 * starts it in the repo root), as `gh` would infer it.
 */
export async function detectRepo(
	env: NodeJS.ProcessEnv = process.env,
	cwd: string = process.cwd(),
): Promise<RepoRef | undefined> {
	if (env.CANVAS_TRACKER_REPO) return parseRepo(env.CANVAS_TRACKER_REPO)
	try {
		const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
			cwd,
			timeout: 5000,
		})
		return parseRepo(stdout)
	} catch {
		return undefined
	}
}
