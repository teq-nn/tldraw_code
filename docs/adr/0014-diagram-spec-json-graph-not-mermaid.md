---
status: accepted
---

# Diagram spec: a JSON graph, not Mermaid

## Context

`render_diagram(spec)` and `compare(items, question)` (#8) draw diagrams as native canvas shapes. The spec (#1) said `render_diagram` "takes Mermaid or a JSON graph spec" and left the canonical format for the MVP open. Whatever the format, the canvas must lay the diagram out itself in the house style (ADR 0004), since Claude supplies structure only, and `compare` must find what differs between 2 or 3 alternatives, which needs a stable identity for every element.

## Decision

The canonical and only spec format for the MVP is a **JSON graph**, validated by `DiagramSpecSchema` (`packages/protocol/src/diagram.ts`):

```jsonc
{
  "nodes": [
    // id: stable key, [A-Za-z0-9_.:-]{1,64}; the same element keeps its id in every alternative
    // look: "box" (default) | "ellipse" (a store, an actor) | "diamond" (a choice)
    { "id": "api", "label": "API" },
    { "id": "db", "label": "SQLite", "look": "ellipse" }
  ],
  "edges": [
    // a directed arrow; label optional, e.g. what flows along it
    { "from": "api", "to": "db", "label": "writes" }
  ]
}
```

- It is the frontier graph's shape (ADR 0005) with `label` and `look` in place of title and status: 1 to 60 nodes, up to 120 edges, the same structural checks (unique ids, edges between known nodes, no self-edges, no duplicates; shared as `checkNodesAndEdges`). Errors come back as `invalid_diagram` / `invalid_comparison` tool errors naming the path, and the canvas is not touched.
- `render_diagram` takes `{ id, title?, spec }`; `compare` takes items `{ label, caption?, spec }`. The spec carries no coordinates, colours or styles; layout and look are the canvas's job.
- Node looks are limited to three geo shapes. More (subgraphs, per-node colours, edge styles) waits until a real question needs it.

## Considered Options

- **Mermaid (`flowchart LR`) as canonical**: Claude writes it fluently and it is compact. But we would parse it ourselves or pull in the `mermaid` package (megabytes, DOM-bound, and its layout would be thrown away for dagre anyway); its node ids are optional in practice (`A[API] --> B[(DB)]` is common, but so is `API --> DB`), which weakens matching between alternatives; and the grammar is much larger than what we render, so accepted input would silently lose meaning (subgraphs, styles, click handlers).
- **Both, Mermaid converted to JSON**: doubles the surface to test and document for no gain in what can be drawn. A small `flowchart` subset parser can be added later as a front end that produces this JSON, without touching the canvas.
- **Reuse `render_graph`'s schema as is**: its `status` and frontier have no meaning in a data-flow or architecture diagram.

## Consequences

- Claude writes a few more characters per diagram than with Mermaid; tool descriptions show the shape, and zod validation reports mistakes precisely.
- Matching alternatives by id (ADR 0015) is exact: Claude controls what counts as "the same element".
- The MCP server never parses diagram text; the protocol schema is the whole contract.
