---
status: accepted
---

# Settling a comparison: the choice pinned to its node, rejected alternatives collapsed with a reason

## Context

#10 asks that after a comparison the chosen alternative is attached to its decision node ("as a thumbnail or link") and that the rejected alternatives stay on the canvas, collapsed, with the reason they lost. Until now a comparison's frames simply stayed as they were (ADR 0015). The chosen alternative is known when `compare` returns, but the reasons are Claude's to write, and in a wayfinder session the graph is re-drawn from the tracker (`sync_wayfinder_map`), which knows nothing about comparisons.

## Decision

- **A canvas tool `settle_comparison({ id, chosen, rejected: [{ label, reason }], node? })`**, called by Claude once the choice is clear. `node` defaults to the comparison id (the skills key a comparison by its decision node). The canvas refuses unless every alternative other than the chosen one has a reason. `compare`'s result reminds Claude to call it after an answer that picks an alternative.
- **The chosen alternative** is marked where it stands: a diagram frame gets a green outline and the title "<label> (chosen)"; a prototype frame gets a green ring and a "Chosen" badge instead of "Prototype".
- **Pinned by a link, not a copy**: a green dashed arrow labelled "chosen" (role `choice_pin`) runs from the decision node to the chosen frame, bound at both ends, so it follows the node through re-layouts and the frame when the user moves it. It is independent of the graph render: re-drawing the graph (from Claude or from the tracker) keeps it; it is removed when its node leaves the graph.
- **Rejected alternatives are collapsed, dimmed and kept**: the frame shrinks to its title bar plus the line "Rejected: <reason>" (a diagram's caption line; a prototype's caption, its viewport hidden), grey, at 50 % opacity. Nothing is deleted: the diagram stays inside the frame, hidden (the canvas's `getShapeVisibility` hides everything in a rejected frame but the caption, since frames do not clip bound arrows), the prototype keeps its HTML, and the full height and original caption are kept in the frame's meta. Resizing the frame opens it again.
- **Frames show their colour** (`FrameShapeUtil` with `showColors`), so the chosen diagram frame's green outline and heading are visible; the pin arcs over the graph (bend) instead of running straight through the nodes between.
- **Idempotent and reversible**: settling again with another choice expands the formerly rejected one and collapses the rest; showing the comparison again with `compare` re-opens it (frames reset, pin removed). One undo step per settle.
- `read_canvas` reports `choice: { state: "chosen" }` or `{ state: "rejected", reason }` on the frames, and the pin with its ends.

## Considered Options

- **Settle automatically when `compare` returns a chosen option**: no extra call, but no reason for the rejected ones, and a sticky-note answer that picks one would not settle at all.
- **A thumbnail of the chosen alternative next to the node**: a second representation the graph layout would have to keep beside a moving node, rendered from a screenshot the canvas cannot take of cross-origin prototypes without the snapshot detour (ADR 0017). The frame itself is the full-size picture; the pin makes it the node's.
- **Carry the choice in `render_graph` input** (`node.choice`): re-applied on every render, but lost on every `sync_wayfinder_map`, which derives nodes from tickets.
- **Delete rejected alternatives, recording the reasons in the node's note**: the spec wants them kept as the record, and a one-line note has no room for them.

## Consequences

- Collapsed frames keep their width: a row of one chosen and two rejected alternatives stays readable left to right.
- A rejected diagram's hidden nodes are still shapes on the page; `read_canvas` lists them, inside a frame marked rejected.
- Re-rendering a rejected prototype with `render_prototype` expands it and clears its choice; the pin stays until the comparison is shown or settled again.
