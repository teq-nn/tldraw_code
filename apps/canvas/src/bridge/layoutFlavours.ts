import type { Editor } from 'tldraw'
import { ANCHORED_FLAVOUR } from './anchoredFlavour'
import type { CommandHandlers } from './BridgeClient'
import { type CommandHandlerDeps, createCommandHandlers } from './commandHandlers'
import { USER_OWNED_FLAVOUR } from './userOwnedFlavour'

/**
 * A layout flavour (docs/research/canvas-layout.md §12): one coherent way
 * for the canvas to place what Claude draws. A flavour builds the command
 * handlers the bridge runs, so it can lay out and place anything a command
 * draws; whatever it does not change, it takes from the baseline's handlers.
 */
export interface LayoutFlavour {
	/** Short name, as given to `pnpm bench:layout <name>` and the canvas's `?layout=<name>`. */
	name: string
	/** One line on what the flavour does differently. */
	summary: string
	createHandlers(editor: Editor, deps?: CommandHandlerDeps): CommandHandlers
}

/** Today's layout, unchanged: the one every other flavour is measured against. */
export const BASELINE_FLAVOUR: LayoutFlavour = {
	name: 'baseline',
	summary:
		'Fresh dagre layout per render at a stored origin; new regions right of everything (ADR 0004, 0005, 0015).',
	createHandlers: createCommandHandlers,
}

/**
 * Every layout flavour, the baseline first. Adding a flavour means adding it
 * here: the layout benchmark scores each one, and the canvas runs the one
 * named in its URL.
 */
export const LAYOUT_FLAVOURS: readonly LayoutFlavour[] = [
	BASELINE_FLAVOUR,
	ANCHORED_FLAVOUR,
	USER_OWNED_FLAVOUR,
]

/** The flavour with this name, or undefined when there is none. */
export function findLayoutFlavour(name: string): LayoutFlavour | undefined {
	return LAYOUT_FLAVOURS.find((flavour) => flavour.name === name)
}
