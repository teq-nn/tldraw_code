---
status: accepted, per-render re-layout superseded by ADR 0032
---

# Graph layout: dagre, computed in the canvas

## Context

`render_graph` (#3) must place decision nodes automatically; Claude supplies structure only, because LLMs are poor at picking coordinates. The spec left ELK or dagre open. `render_diagram` and `compare` (#8) must later lay out diagrams "in the same style", and node sizes depend on how tldraw wraps each label, which is only known in the browser.

## Decision

- Use **dagre** (`@dagrejs/dagre`) for layered layout. Frontier graphs are small (tens of nodes), directed and mostly acyclic, which is exactly dagre's sweet spot. It is synchronous, small and pure JS, so it runs in the same tick as the shape updates and in jsdom tests without a worker. ELK (`elkjs`) gives better edge routing, ports and compound nodes, but it is a ~1.5 MB GWT transpile with an async API, and tldraw arrows draw their own routes anyway, so we would pay for routing we throw away.
- Run the layout **in the canvas**, not the MCP server, in line with ADR 0002 ("layout and shape details stay in the browser"). The canvas creates or updates the node shapes first, measures their real bounds, then lays them out with those sizes.
- The house style lives in one pure function, `layoutGraph` with `GRAPH_LAYOUT_STYLE` (`apps/canvas/src/graph/layout.ts`): left to right (blockers left of what they block), node gap 40, rank gap 90. #8 reuses it so compared diagrams differ only in content, not in layout.

## Consequences

- Every render re-runs the layout, so a node the user dragged snaps back to its laid-out place on the next `render_graph` (see ADR 0005). _Superseded by ADR 0032: the layout runs for a new graph and for a tidy; a placed node keeps its place._
- If graphs ever grow into the hundreds, or need nested groups (compound nodes), ELK is the fallback; only `layoutGraph` would change.
- The MCP server never sees coordinates; tests of the tool interface stay independent of layout.
