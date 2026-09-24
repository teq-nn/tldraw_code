---
status: accepted
---

# A fourth decision status, `in_progress`, for claimed tickets

## Context

ADR 0012 drew an open ticket that is assigned (claimed by a session) as `blocked`, red and dashed, with the note "Claimed by @login". That kept the canvas frontier equal to the tracker's frontier, but it put the ticket the session is working on in the same colour as tickets that cannot move, exactly while the user is looking at it. With the canvas wayfinder skill (#10) the claimed ticket is the centre of the session: it is claimed first, questions about it are asked on the canvas, and it stays claimed until it is resolved. ADR 0012 left a fourth status to #10.

## Decision

- **`DecisionStatus` is `open | in_progress | resolved | blocked`.** `in_progress` means "being decided right now": a claimed ticket, or in a grilling session a decision Claude is working on with the user. It is valid input to `render_graph` like the other three.
- **Off the frontier, and still gating.** `computeFrontier` is unchanged: only `open` nodes whose blockers are all `resolved` are on it. An `in_progress` node is not on the frontier and, not being resolved, keeps its dependents off it. The canvas frontier therefore stays exactly the tracker's frontier: open, unblocked, unclaimed.
- **Look**: amber (tldraw `yellow`), semi fill, solid outline. Blue stays open, green resolved, red blocked; orange stays reserved for differences between compared alternatives (ADR 0015).
- **Tracker mapping** (amends the table of ADR 0012): an open, assigned ticket is `in_progress` with the note "Claimed by @login". The blocking rules come first: a claimed ticket that also has an open blocker outside the map or a `blocked` / `needs-info` label is `blocked`, because that is what stops it.
- `read_canvas` reports `status: "in_progress"` for amber decision nodes.

## Considered Options

- **Keep claimed tickets `blocked`** (ADR 0012): no schema change, but it misreads the most relevant node of a wayfinder session.
- **Draw claimed tickets `open` with a marker**: blue suggests "take me", and a second session could pick a ticket another holds.
- **Tell the viewer's own claims apart from other people's**: needs the viewer's identity in the MCP server; not needed for the MVP, where one dev drives the map.

## Consequences

- The graph schema, the canvas colours and the tracker sync change together; older canvases in the browser store keep their shapes and are recoloured at the next render.
- ADR 0005 (three statuses) and ADR 0012 (claimed = blocked) are amended by this ADR.
