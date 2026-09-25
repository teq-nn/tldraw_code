---
status: accepted
---

# The canvas is user-owned space: placed nodes stay put, a tidy only on request

## Context

ADR 0005 laid the frontier graph out afresh on every `render_graph`, at a stored origin: "positions are always recomputed, so manual moves of graph nodes are not preserved". The research on canvas layout (`docs/research/canvas-layout.md` §3, §11, §13) found this at odds with the mental-map evidence: users find things again by where they are [AP12], and half measures at stability are worst [PS08]. The concrete harm is to annotations. A user's note annotates the node it lies on or near (ADR 0008), so a node that moves away leaves the note beside the wrong thing.

To decide, #25 built a layout benchmark (`pnpm bench:layout`): one scripted session replayed headless and scored on graph quality, stability, ownership, overlaps, attention and footprint. Three layout flavours ran side by side, each with a `canvas-layout` skill variant:

- **Baseline**: ADR 0005 as it was.
- **F1 "anchored"** (#27): the same global dagre layout, made stable by keeping one dagre graph per page and the in-rank order of persisting nodes.
- **F2 "user-owned"** (#28, #29): a node, once placed, never moves. New nodes go into free space beside their blockers. A full re-layout runs only as a tidy the user asked for.

The scorecard at cd9a51e (aggregates over the scene; `user-owned+tidy` is F2 with a tidy after step 7):

| | baseline | anchored | user-owned | user-owned+tidy |
| --- | --- | --- | --- | --- |
| Crossings (1 = none) | 0.99 | 0.98 | 0.96 | 0.97 |
| Backward edges | 0 | 0 | 0 | 0 |
| Mean displacement | 162 | 147 | 7 | 7 |
| Max displacement | 311 | 259 | 150 | 150 |
| Orthogonal order kept | 0.83 | 0.89 | 1.00 | 1.00 |
| Nearest neighbour kept | 0.86 | 0.87 | 0.95 | 0.95 |
| User shapes moved | 0 | 0 | 0 | 2 |
| Anchors kept | 2/4 | 2/4 | 4/4 | 4/4 |
| Overlaps Claude/user | 3 | 3 | 0 | 0 |
| Focus distance | 386 | 386 | 348 | 387 |
| Footprint | 6364 x 1630 | 6364 x 1630 | 6364 x 1555 | 6364 x 1630 |

The user walked through the runs step by step in the layout demo (`?demo`) and chose F2 (#31).

## Decision

- **The canvas is user-owned space, by default and without a switch.** `render_graph` never moves a node it drew before, including one the user dragged. A new node goes into free space in the rank slot right of its blockers (left of its dependents when it is a new blocker), else higher or lower in that column, else the nearest free spot. It keeps beyond anchor reach of the user's shapes. A node that leaves the graph leaves its gap. A new graph is laid out whole (dagre, ADR 0004) and moved into free space. A new question card keeps clear of the user's shapes in the same way.
- **A tidy is a one-shot full re-layout, on the user's request.** `render_graph` (or, on a wayfinder map, `sync_wayfinder_map`) with `tidy: true` lays the whole graph out afresh at its stored origin, clear of rows to its right and of cards, notes and frames below it (#26). Every user shape anchored to a node moves with that node, so it keeps its anchor. The next render places in free space again. The `canvas-layout` skill runs a tidy when the user asks and offers one past a drift threshold: two or more crossings, any edge running right to left, an overlap, or a new node placed away from its blockers.
- **Baseline and F1 are removed**, with F1's skill variant and tests. What F2 reuses of the baseline stays: the whole layout (`apps/canvas/src/graph/layOutWholeGraph.ts`), which a first render and a tidy use, together with `clearOfRows` and `clearOfPlaced`.
- **The flavour registry and `?layout=` are removed too.** With one layout, a one-entry registry, a URL switch and a `LayoutFlavour` interface are code every reader must trace for no choice. `renderGraph` keeps one seam, `PlaceGraph`, because it has two real placements: free space for a render and the whole layout for a tidy. The benchmark keeps its list of runs in `apps/canvas/bench/main.ts`: `user-owned` and `user-owned+tidy`. A future layout experiment adds its run there and gives `runScene` its own command handlers. Commits ee2b861 and 43b9e2f show how a flavour was wired, if a registry is ever wanted again. That keeps #25's aim, one place to add a run, without carrying the machinery between experiments.
- **The benchmark metric "user shapes moved" stays as it is.** It counts the two notes a tidy moves with their anchored node on purpose. A tidy is the one time Claude's command moves user shapes, and the count shows it.

## Considered Options

- **Keep the baseline**: the fewest crossings (0.99), but it moves every node on every render and lost half the anchors (2/4). It also put Claude's shapes over the user's 3 times.
- **F1 "anchored"**: a little more stable than the baseline (order kept 0.89 against 0.83), but nodes still moved by 147 units on average and anchors were lost as often. This is the "medium" stability [PS08] warns about.
- **F3 "regions" and F4 "focus stream"** (research §12): not built. F2 already scored 0 moved shapes and 4/4 anchors, and neither targets the harm ADR 0005 caused.
- **Keep the registry and `?layout=` as a one-entry seam**: cheap to keep, but dead weight until the next experiment. That experiment would redesign the seam around what it varies anyway.

## Consequences

- This supersedes the placement bullet of ADR 0005 ("positions are always recomputed, so manual moves of graph nodes are not preserved"). The stored origin still anchors a first render's block and a tidy.
- Crossings drift up as a graph grows (0.96 against 0.99 over the scene). The tidy is the remedy, and it is the user's call.
- A render never closes gaps, so a graph that loses many nodes stays spread out until a tidy.
- A tidy moves the user's notes along with their nodes. It is the one exception to "Claude never moves the user's shapes", and it happens only on request.
- The `canvas-layout` skill (`.agents/skills/canvas-layout`, loaded by canvas-grilling and canvas-wayfinder) teaches Claude this contract: stable ids, new content given an edge to its subject, a check after each render, and when to run or offer a tidy (#30).
