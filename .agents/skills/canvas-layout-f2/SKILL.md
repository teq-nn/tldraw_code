---
name: canvas-layout
description: How to place and update what you draw on the shared tldraw canvas so the user's arrangement survives. Use when drawing or updating the decision graph with `render_graph`, adding notes or questions beside it, or when the user asks to tidy the canvas.
---

**F2 candidate** ("user-owned space", `docs/research/canvas-layout.md` §12). This variant pairs with the canvas's layout flavour F2 (`?layout=user-owned`, `apps/canvas/src/bridge/userOwnedFlavour.ts`). It competes with the other `canvas-layout` variants in the layout benchmark, and it is not registered in `.claude/skills` until one is chosen.

The canvas is **user-owned space**: what is on it stays where it was left. The user finds things again by where they are, and their sticky notes annotate a node by lying on or near it (ADR 0008), so a node that moves takes the meaning of their notes with it. Under F2 the canvas keeps this for you:

- `render_graph` never moves a node it drew before, including one the user dragged somewhere else.
- A new node goes into free space in the slot right of its blockers, else the nearest free spot, clear of the user's notes.
- A node you drop leaves its gap; nothing closes up.

Your part is to give the canvas what it needs to keep that promise, and to check that it did.

## Rules

- **Stable ids.** A node's `id` is its place on the canvas. Each time you call `render_graph`, keep every id you passed before and change `title`, `status` or `note` instead. A new id is a new node in a new place, and the old one's position and the user's notes on it are lost.
- **New content beside its subject.** A new node is placed from its edges, so give it the edge from what it is about (its blocker) in the same call that adds it. A node with no edge to anything drawn lands under the graph. Answer a user's note with `render_note` and `replyTo`, so the reply sits next to that note.
- **The user's arrangement is the layout.** A node the user dragged is where they want it; leave it there. When the graph looks crowded, keep rendering; the fix is a tidy the user agrees to (below).

## After every render

Call `read_canvas` and look at the screenshot. Done when you have checked that:

- every node you added sits beside the nodes it depends on;
- nothing you drew covers a user note, drawing or another shape of yours;
- every user note still lies on or next to the node it was about.

When one of these fails, say what you see in one terminal line, and consider a tidy.

## Tidy

A tidy lays the whole graph out afresh, once: crossings go away, and every node moves. It is the user's call, never yours alone.

- **Offer one** when the screenshot shows the graph drifting: edges crossing or running right to left, new nodes far from their blockers, or the graph hard to follow. Offer with `ask` ("Tidy the graph? Every node moves.", options "Tidy it" and "Leave it"), at most once until the graph drifts further.
- **Run one** when the user asks for it, in a sticky note ("tidy up") or an answer.
- A declined tidy stays declined: keep rendering in place.

Running the tidy needs a tidy option on `render_graph`, which this candidate does not have yet (issue #29). Until it has, tell the user in one terminal line that the tidy is not available, and keep the graph as it is.
