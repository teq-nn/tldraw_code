/**
 * A tool call that cannot be carried out as asked: its arguments are
 * inconsistent (e.g. an edge to an unknown node), or it conflicts with a call
 * still running. Reported to Claude as a tool error `[code] message`.
 */
export class ToolInputError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message)
		this.name = 'ToolInputError'
	}
}
