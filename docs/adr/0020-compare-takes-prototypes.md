---
status: accepted, placement amended by ADR 0029
---

# `compare` takes prototypes too: the same compare-and-ask flow for UI choices

## Context

`compare` (ADR 0015) put 2 or 3 diagrams side by side and attached a question card below them. UI choices had no such tool: the skill rendered each prototype with `render_prototype` and then called `ask`, so the card landed below the frontier graph, far from the prototypes, and the options could drift from the labels on the frames (ADR 0017 left folding prototypes into `compare` to #10). The spec's `compare(items, question)` names "diagrams or prototypes".

## Decision

- **An item is a diagram or a prototype**: `{ label, caption?, spec }` or `{ label, caption?, html, width?, height?, id? }`. One comparison holds one kind: all items have `spec`, or all have `html`; anything else is `invalid_comparison`. The schema lives in `packages/protocol/src/compare.ts`.
- **Prototype items are prototypes** in every other respect: rendered through the existing `prototype.render` command (sandbox of ADR 0016, frames of ADR 0017), one call per item in order, with `comparison: { id, index }` in the payload. Their id is the item's `id`, else `<comparison id>-<slug of the label>`, so `render_prototype` can iterate on one later (`iterationOf`).
- **Placement**: the first prototype of a new comparison goes right of the page content, each next one right of the one before, top-aligned (sliding past anything in the way). The canvas stores `comparisonId` and `comparisonIndex` in the frame's meta. `ask.show` with `comparison` places the card centred below the comparison's frames, diagrams or prototypes.
- **A growing graph gives way to the rows**: rows of diagram and prototype frames go to the right of the page content (ADR 0015), and a wayfinder graph grows as tickets are added. When a re-render would run the graph into a row to its right, `graph.render` moves the graph's origin left by the overlap instead, so the rows stay where the user saw them.
- **No diff for prototypes**: there is no structure to match; each item's caption says what sets it apart.
- The rest is `compare` as before: it refuses while another question waits, blocks like `ask`, re-renders in place when called again with the same arguments after "no answer yet", and its card collapses on the next graph render.

## Considered Options

- **A separate `compare_prototypes` tool**: one more tool name for Claude to choose between, for the same flow.
- **Mixed comparisons** (a diagram against a prototype): no use case, and it would mix row layouts.
- **A single `comparison.render` command for prototype rows**: one round trip instead of up to three, but a second code path for placing and updating prototype frames.

## Consequences

- A comparison re-rendered with fewer prototype items leaves the dropped prototype on the canvas (diagram frames are removed); it is still a normal prototype the user can delete.
- `render_prototype` stays for single prototypes and iterations; its description now points UI choices to `compare`.
- `read_canvas` reports a compared prototype's comparison id.
