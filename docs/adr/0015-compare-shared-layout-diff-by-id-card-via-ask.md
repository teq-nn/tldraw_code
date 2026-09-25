---
status: accepted, extended by ADR 0020 (prototype items) and ADR 0021 (settling)
---

# `compare`: frames side by side, one shared layout, differences by id, the card via `ask`

## Context

`compare(items, question)` (#8) must put 2 or 3 alternative diagrams next to each other in their own frames, highlight what differs in colour, use the same layout style as `render_graph`, and attach a question card through `ask`. `render_diagram` draws a single diagram the same way. The frontier graph owns its shapes by node id with one graph per page (ADR 0005), so several diagrams need their own keys. Spec story 15 asks that compared diagrams are laid out alike "so that differences are not distorted by layout accidents".

## Decision

- **One canvas command, `diagram.render`,** draws a row of 1 to 3 frames: one for `render_diagram` (`kind: "diagram"`), 2 or 3 for `compare` (`kind: "comparison"`). Shapes are keyed by kind, id, frame index and element (`shape:diagram-node:comparison:ingest#1/queue`) and carry `meta.diagramPart`; a repeated call with the same kind and id updates them in place, deletes what is gone (including a dropped third alternative), and never touches the frontier graph or other diagrams. One undo step per call.
- **Native shapes in a frame:** each diagram is a tldraw `frame` titled with the diagram's title or the alternative's label, holding geo nodes and bound arrows (with edge labels). The user can move, select and draw on every shape; moving a frame moves its diagram. A comparison frame starts with its caption (one sentence on what sets it apart) and the legend line "Orange: differs from the other alternatives".
- **One layout for all frames:** the canvas lays out the **union** of the alternatives' nodes and edges with `layoutGraph` (dagre, `GRAPH_LAYOUT_STYLE`, ADR 0004), each node slot sized to its largest rendering, and every frame uses those positions. A node common to the alternatives therefore sits in exactly the same place in each frame, frames are the same size, and only real differences stand out. Nodes use the frontier graph's look (sans text, 180 wide).
  - **Exception, conflicting orders (#23):** when the alternatives connect the same nodes in different orders (A before B in one, B before A in another), the union has cycles no alternative has, and dagre's way out of them sends edges backwards and bends the chains, so a plain linear flow looks tangled. So the shared layout is used only when every edge of every alternative points left to right in it (edges on a cycle of the alternative itself exempt); otherwise each frame gets a layout of its own graph (`layoutFrames`, `apps/canvas/src/diagram/frameLayouts.ts`), still in slots sized to the largest rendering, frames sized to the largest layout. Each flow read in its own edge order beats alignment between flows that disagree on the order.
- **Differences by id, computed by the server:** `diffAlternatives` (protocol) matches nodes by id and edges by `from->to`. An element differs in an alternative when not every alternative has it (`not_in_all`) or when they all have it but the label or look differs (`changed`). The server sends the ids to highlight with the command and lists them per alternative in the tool result; the canvas draws them orange (nodes with a solid fill, edges heavier), the rest black and grey.
- **The card via `ask`:** after rendering, `compare` calls the same `AskCoordinator` as `ask` with the alternatives' labels as options and the recommendation marked; `ask.show` gets `comparison: <id>` and places a new card centred below that comparison's frames. `compare` blocks, times out ("no answer yet": call `compare` again with the same arguments, which re-renders in place and re-attaches to the card) and collapses on the next `render_graph` exactly like `ask` (ADR 0006, 0007, 0010). It refuses to start while another `ask` waits, before drawing anything.
- **Placement:** a new diagram or comparison row goes to the right of everything on the page, top-aligned with it, so the space below the frontier graph stays free for question cards; its origin is remembered in the shapes' meta so re-renders do not jump. The camera pans to a new row when it is out of view.
- **Perception:** `read_canvas` reports `diagram_frame`, `diagram_node` and `diagram_edge` roles with their diagram, alternative, element and whether it differs, and a user's sticky note or drawing on a diagram node or frame gets it as its anchor (smallest overlap first, so a node beats its frame). A remark on one alternative is thereby assigned to that alternative.

## Considered Options

- **Lay out each alternative on its own**: simpler, but dagre may put a shared node in a different rank or row per alternative, which is exactly the layout accident story 15 warns about. The union layout costs empty slots in frames (an alternative without the queue has a gap where it would be); we accept that, since the gap itself shows the difference.
- **Match nodes by label as well as id**: friendlier when Claude forgets to reuse ids, but a relabelled node (an intended change) would then show up as a removal plus an addition. The tool description tells Claude to reuse ids; ids are exact.
- **One colour per kind of difference (added / changed)**: more information but one more legend entry to read; one highlight colour, with the kinds spelled out in the tool result, keeps the canvas quiet.
- **`compare` returns at once and Claude calls `ask` separately**: two calls that can drift apart (card options not matching frames, card placed below the graph instead of the frames). The spec wants the card attached automatically.
- **Put comparison frames below the graph**: they would collide with the question cards placed there (ADR 0007).

## Consequences

- Several diagrams and comparisons can live on one page; old comparisons stay as a record until Claude or the user removes them. Keeping rejected alternatives collapsed next to the decision node is left to the canvas wayfinder skill (#10).
- Like the frontier graph, manual moves of nodes inside a frame are reset on the next render of that diagram; moving the whole frame is kept only until then too (the stored origin wins).
- `render_prototype` (#9) can join `compare` later as a second item type in the same row of frames; the diff and the shared layout apply only to diagram items.
- The canvas grilling skill asks choices between structures or flows with `compare` and may show a single structure with `render_diagram`; this refines ADR 0011's consequence that the skill knows only question cards. UI alternatives stay short named options until `render_prototype` (#9).
