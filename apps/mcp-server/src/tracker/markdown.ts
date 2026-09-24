import type { RepoRef } from './github'

/**
 * The body conventions of a wayfinder map and its tickets
 * (`docs/agents/issue-tracker.md`), for trackers or repositories where the
 * native sub-issue and dependency links are missing, and for what only the
 * map body holds (the gists of Decisions so far, the Out of scope list).
 */

/**
 * Numbers of the issues of `repo` referenced in `text`, in order, without
 * duplicates: `#12`, `owner/name#12` and `https://github.com/owner/name/issues/12`.
 * References to other repositories are ignored.
 */
export function issueRefs(text: string, repo: RepoRef): number[] {
	const found: { index: number; number: number }[] = []
	const sameRepo = (owner: string, name: string) =>
		owner.toLowerCase() === repo.owner.toLowerCase() &&
		name.toLowerCase() === repo.name.toLowerCase()
	for (const m of text.matchAll(/(?<![\w/#])#(\d+)\b/g)) {
		found.push({ index: m.index, number: Number(m[1]) })
	}
	for (const m of text.matchAll(/(?<![\w/])([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#(\d+)\b/g)) {
		if (sameRepo(m[1] ?? '', m[2] ?? '')) found.push({ index: m.index, number: Number(m[3]) })
	}
	for (const m of text.matchAll(
		/https?:\/\/[^/\s]+\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\b/g,
	)) {
		if (sameRepo(m[1] ?? '', m[2] ?? '')) found.push({ index: m.index, number: Number(m[3]) })
	}
	found.sort((a, b) => a.index - b.index)
	return [...new Set(found.map((ref) => ref.number))]
}

/** The lines under the first heading named `heading` (any level), up to the next heading. */
export function markdownSection(body: string, heading: string): string | undefined {
	const lines = body.split(/\r?\n/)
	const wanted = heading.toLowerCase()
	const start = lines.findIndex(
		(line) =>
			/^\s{0,3}#{1,6}\s/.test(line) &&
			line
				.replace(/^\s*#+\s*/, '')
				.replace(/[\s:#]*$/, '')
				.toLowerCase() === wanted,
	)
	if (start < 0) return undefined
	const rest = lines.slice(start + 1)
	const end = rest.findIndex((line) => /^\s{0,3}#{1,6}\s/.test(line))
	return (end < 0 ? rest : rest.slice(0, end)).join('\n')
}

/**
 * Blockers named in a ticket body: a `Blocked by: #3, #4` line (the tracker
 * fallback for native dependencies) or a `## Blocked by` section listing them
 * (the `to-tickets` format).
 */
export function blockerRefs(body: string, repo: RepoRef): number[] {
	const refs: number[] = []
	for (const m of body.matchAll(/^[\s>*_-]*blocked by[*_]*\s*:[*_]*(.*)$/gim)) {
		refs.push(...issueRefs(m[1] ?? '', repo))
	}
	const section = markdownSection(body, 'Blocked by')
	if (section) refs.push(...issueRefs(section, repo))
	return [...new Set(refs)]
}

/** Issues listed as task-list items (`- [ ] #12`) in a map body: the fallback for sub-issues. */
export function taskListRefs(body: string, repo: RepoRef): number[] {
	const refs: number[] = []
	for (const m of body.matchAll(/^\s*[-*+]\s+\[[ xX]\]\s+(.*)$/gm)) {
		const first = issueRefs(m[1] ?? '', repo)[0]
		if (first !== undefined) refs.push(first)
	}
	return [...new Set(refs)]
}

/**
 * The one-line gists in the map's Decisions so far, by ticket number. Lines
 * look like `- [Ticket title](link): gist of the answer`.
 */
export function decisionGists(body: string, repo: RepoRef): Map<number, string> {
	const gists = new Map<number, string>()
	const section = markdownSection(body, 'Decisions so far')
	if (!section) return gists
	for (const m of section.matchAll(/^\s*[-*+]\s+(.*)$/gm)) {
		const item = m[1] ?? ''
		const ticket = issueRefs(item, repo)[0]
		if (ticket === undefined || gists.has(ticket)) continue
		const link = /^\[[^\]]*\]\([^)]*\)/.exec(item)
		const after = link ? item.slice(link[0].length) : item.slice(item.indexOf(': ') + 1)
		const gist = after
			.replace(/^[\s:\u2013\u2014-]+/, '')
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
			.trim()
		if (gist && (link || item.includes(': '))) gists.set(ticket, gist)
	}
	return gists
}

/** Tickets linked from the map's Out of scope section. */
export function outOfScopeRefs(body: string, repo: RepoRef): number[] {
	const section = markdownSection(body, 'Out of scope')
	return section ? issueRefs(section, repo) : []
}
