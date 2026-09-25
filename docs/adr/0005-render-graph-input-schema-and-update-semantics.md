---
status: accepted, amended by ADR 0018 (fourth status in_progress); placement superseded by ADR 0032
---

# `render_graph` input schema, frontier and update semantics

## Context

`render_graph` (#3) turns a node/edge structure from Claude into tldraw shapes and must update rather than duplicate them on repeated calls. The shape of its `graph` argument is the contract that the canvas grilling skill (#5), the tracker sync (#7) and `render_diagram` (#8) build on, so it needs to be pinned down.

## Decision

The tool takes the **whole graph** on every call (declarative, not a diff):

```jsonc
{
  "nodes": [
    // id: stable key, [A-Za-z0-9_.:-]{1,64}, e.g. a ticket number or slug
    // status: "open" | "resolved" | "blocked"
    // note: optional one-liner under the title, e.g. the answer a decision got (#5)
    { "id": "storage", "title": "Storage engine", "status": "resolved", "note": "SQLite" },
    { "id": "schema", "title": "Schema design", "status": "open" }
  ],
  "edges": [
    // from must be resolved before to ("from blocks to"); defaults to []
    { "from": "storage", "to": "schema" }
  ]
}
```

- Validation (`FrontierGraphSchema` in `packages/protocol/src/graph.ts`): 1 to 200 nodes, up to 400 edges, unique node ids, edges only between known nodes, no self-edges, no duplicate edges. Violations come back as an `invalid_graph` tool error naming the offending path; the canvas is not touched. Cycles are allowed (dagre breaks them); nodes on an unresolved cycle are simply never on the frontier.
- The **frontier is derived, never supplied**: open nodes whose blockers (all `from` ends of incoming edges) are resolved. The MCP server computes it (`computeFrontier`), sends it with the `graph.render` command, and echoes it in the tool result so Claude sees what is next. `status` is taken as given: an `open` node with an unresolved blocker stays blue but is off the frontier; `blocked` is for decisions blocked by something outside the graph or explicitly parked.
- **Look**: status is the colour (open blue, resolved green, blocked red, blocked also dashed). Frontier nodes stand out with a tinted solid fill, heavy outline and larger text; everything else keeps a plain white fill. Edges are grey arrows bound to both nodes, so they follow when the user drags a node.
- **Identity and updates**: each node's shape id is derived from its node id (`shape:graph-node:<id>`), each edge's from its endpoints (`shape:graph-edge:<from>-><to>`), and every graph shape carries `meta.graphPart`. A call updates existing shapes in place, creates missing ones and deletes graph shapes whose node or edge is gone; shapes it does not own are never touched. The whole update is one undo step.
- **Placement**: a first render is centred in the viewport (zooming out if needed); the layout origin is stored in each graph shape's meta, and later renders reuse it, so the graph does not jump when the user has panned away. Positions are always recomputed, so manual moves of graph nodes are not preserved. _Superseded by ADR 0032: a placed node keeps its place, manual moves included; the graph is laid out afresh only by a tidy._

## Considered Options

- **Incremental calls only** (`add_node` / `update_node`, still planned from the spec): easier for tiny changes, but Claude would have to track what is on the canvas. The full-graph call is idempotent and matches how #7 derives the graph from the tracker; the incremental tools can later be thin wrappers that patch the last graph and re-render.
- **Claude supplies the frontier**: redundant with the edges and easy to get inconsistent.
- **Preserve manual positions**: needs layout pinning and conflict rules; deferred until users actually ask for it.

## Consequences

- There is one graph per canvas page. Several independent graphs (e.g. #8's comparisons) need a graph key, which would extend the shape ids and meta, not break this schema.
- Answered questions (#5) show up as the node's `note`; attaching variants and thumbnails (#10) will need new optional node fields.
