---
name: canvas-layout
description: Keep what Claude draws on the shared tldraw canvas findable across updates, by feeding the canvas's layout stable input and checking each render. Use whenever you call `render_graph`, `sync_wayfinder_map`, `render_diagram` or `compare` more than once in a session, such as in a canvas-grilling or canvas-wayfinder session.
---

**Candidate F1 "anchored"** (issue #27). This variant pairs with the canvas's `anchored` layout flavour (`?layout=anchored`, `apps/canvas/src/bridge/anchoredFlavour.ts`). It competes with the other `canvas-layout` variants in the layout benchmark, and it is not registered in `.claude/skills` until one is chosen. Its grounds are in `docs/research/canvas-layout.md`, sections 3, 11, 12 and 13.

The canvas owns the coordinates. You pass structure only, and every render lays the whole graph out again at the graph's stored origin. The anchored flavour keeps that layout **stable**: it hands nodes to dagre in the order they first appeared, and persisting nodes that share a rank keep their top-to-bottom order. What is still up to you is the input it works from. The user finds their way around by position ("where did `schema` go?"), and stable positions make that faster and less error-prone [AP12]. Their sticky notes stay where they put them, anchored to the nearest node within 160 units (ADR 0008). A node that moves away leaves its note behind.

## Stable input

- **Ids are identity.** A decision, ticket or diagram element keeps its id for the whole session, whatever its title, note or status becomes. A new id is a new node: it lands wherever the layout puts it, its arrows are redrawn, and the user's notes lose it. Rename by changing `title`, never `id`.
- **Order is append-only.** List nodes and edges in the order you first introduced them, and add new ones at the end. Keep that order on every call rather than re-sorting by status, title or frontier. The canvas builds its in-rank order from yours, and after a reload of the canvas your order is all it has.
- **Keep nodes rather than drop them.** A settled decision stays as a `resolved` node with its note. A parked one stays as `blocked`. Removing a node or an edge re-ranks everything downstream of it, so remove only what is truly wrong, such as a decision that turned out to be a duplicate.
- **Batch each answer into one render.** Apply everything one answer changes (the resolution, the narrower decisions it raises, a changed edge) in a single `render_graph` call. Each call is a re-layout, and every intermediate render makes the user's view jump once more.
- **Edges point with the flow.** `from` is always the blocker, so the graph reads left to right. An edge you add backwards to "fix" a position turns into a backward edge or a cycle, and the whole layout shifts.

## Compared alternatives

In a `compare`, the alternatives share one layout (foresighted layout, ADR 0015), so the user sees only what differs [DGK01].

- Give the same element the **same node id in every alternative**, and list the shared nodes in the same order in every spec.
- Share positions **unless that creates backward edges.** Write each alternative's edges in its own flow direction, including an alternative that reverses two steps. The canvas then lays out that frame on its own rather than drawing its edges backwards (#23). Never bend an alternative's edges to match another's positions.
- An iteration of a prototype or diagram keeps the ids of what it keeps.

## Check every render

After each `render_graph`, `sync_wayfinder_map`, `render_diagram` or `compare`, call `read_canvas` and check the result against these rules. Use the shape data for the checks and look at the screenshot for anything the data cannot show. The check is done when each rule below has been checked against the new canvas.

1. **Anchors held.** Every user note or drawing that was anchored to a node before the render is still anchored to that node. If an anchor moved, the note is now beside the wrong thing. Say so in your next question card or `render_note` reply, naming the node it was about, so the user can drag it back. You never move the user's shapes.
2. **Nothing covers the user.** No Claude shape lies on top of a user shape. If one does, mention it the same way.
3. **The new thing is visible.** What you just drew or changed is inside the viewport the screenshot shows.
4. **The graph reads forward.** Every edge points left to right, and no two nodes overlap. A backward edge means an edge you passed is the wrong way round or closes a cycle: fix the input and render again.

When a check fails because of layout, not input (a node jumped though you kept ids and order), note it in the terminal status line as layout feedback for the flavour. Leave the input as it is.
